/*
 * Copyright 2011 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you
 * may not use this file except in compliance with the License. You
 * may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
 * implied.  See the License for the specific language governing
 * permissions and limitations under the License.
 *
 * Authors: klao@google.com, napszel@gmail.com, errge@google.com
 */

// This file contains the main UI logic: inputbox, cursor,
// autocompletion table, slinglet

// TODO(errge): write some doc for this code

////////////////////////////////////////////////////////////////////////////////
// Cursor

function Cursor() {}

Cursor.prototype = {
  reset: function(first, last, n) {
    this.first_ = first;
    this.last_ = last;
    this.i_ = 0;
    this.selected_ = first;
    this.selected_.addClass("selected");
    this.n_ = n;
    if (n > 1) this.next();
  },

  reposition: function() {
    var w = $(window);
    var hei = w.height();
    var top = w.scrollTop();
    var bot = w.scrollTop() + hei;
    var pos = this.selected_.position().top;

    if (pos - top > hei * 0.85) {
      w.scrollTop(pos - hei * 0.85);
    }

    if (pos - top < hei * 0.15) {
      w.scrollTop(pos - hei * 0.15);
    }
  },

  next: function() {
    this.selected_.removeClass("selected");
    if (this.i_ == this.n_-1) {
      this.selected_ = this.first_;
      this.i_ = 0;
    } else {
      this.selected_ = this.selected_.next();
      this.i_++;
    }
    this.selected_.addClass("selected");
    this.reposition();
  },

  prev: function() {
    this.selected_.removeClass("selected");
    if (this.i_ == 0) {
      this.selected_ = this.last_;
      this.i_ = this.n_-1;
    } else {
      this.selected_ = this.selected_.prev();
      this.i_--;
    }
    this.selected_.addClass("selected");
    this.reposition();
  }
};

////////////////////////////////////////////////////////////////////////////////
// InputBox

function InputBox(id, label, width) {
  this.inputhandler = $('<input spellcheck="false" type="text"'
                        + (width ? ' style="width: '+ width + '"' : '')
                        + ' id="' + id + '"></input>');
  if (this.constructor.name == 'InputBox') {
    // subclasses may have their own keypress handling routine.  If not,
    // they can still set up this handler connection by themselves
    this.inputhandler.keypress(util.bind(this.inputHandlerKeypressBindme, this));
  }
  if (label) {
    this.inputui = $("<span>" + label + ": </span>");
    this.inputui.append(this.inputhandler);
  } else {
    this.inputui = this.inputhandler;
  }
  this.inputui.focusin(function () {
    $("#completiontable > table").hide();
  });
}

InputBox.prototype.inputHandlerKeypressBindme = function (event) {
  if (event.which == 13) { // enter
    this.action();
    return false;
  }
  return true;
};

InputBox.prototype.action = function() {};

InputBox.prototype.appendTo = function(input_container) {
  input_container.append(this.inputui);
};

////////////////////////////////////////////////////////////////////////////////
// Completer

function Completer(id, label, width, dataset, dataset_labels, dataset_ids) {
  this.__super.call(this, id, label, width);
  this.inputhandler.attr('autocomplete', 'off');
  var inp = this.inputhandler;
  if (this.constructor.name == 'Completer') {
    inp.keypress(util.bind(this.inputHandlerKeypressBindme, this));
    inp.keydown(util.bind(this.inputHandlerKeydownBindme, this));
  }
  this.compui = $("<table></table>");
  this.compui.hide();
  var self = this;
  this.inputui.focusin(function () {
    self.compui.show();
    self.fillTableStart(inp.val());
  });

  this.dataset = dataset;
  this.dataset_ids = dataset_ids;
  this.dataset_labels = dataset_labels;

  this.pendingFillReqId = null;
  this.pendingFillReqHandler = util.bind(this.pendingFillReqHandlerBindme,
                                         this);

  this.maxResults = 50;
  this.cursor = new Cursor();
}
util.extend(Completer, InputBox);

Completer.arr1 = function(arr) { return arr[1]; };

// Computes the result of the completion from the selected row.
// Returns the first column's value by default, but can be overridden
// in subclasses.
Completer.prototype.useRow = function(o) {
  return o[this.dataset_ids[0]];
};

Completer.prototype.complete = function(focusafter, i) {
  if (i === undefined) i = this.cursor.i_;
  if (i > 0) { // user wants to use the result of autocompletion
    var o = this.cached_table[i-1][1];
    this.inputhandler.val(this.useRow(o));
    if (focusafter) this.action(o); // callback to the slinglet with the selected datarow
  } else {
    if (this.inputhandler.val() == "") {
      this.emptyAction();
    } else {
      this.action(this.inputhandler.val()); // callback with the input text
    }
  }
};

// A completer subclass can change the behavior for the activationof empty
// user input, e.g. the bookmark completer presents the user manual.
Completer.prototype.emptyText = "No value, thanks!";
Completer.prototype.emptyAction = function() {
  this.action("");
}

Completer.prototype.fillTableStart = function(str) {
  if (str === this.cached_str) {
    this.fillTableEnd(str);
    return;
  }

  this.working_str = str;
  this.working_idx = 0;
  if (this.cached_str !== undefined && str.indexOf(this.cached_str) == 0) {
    this.working_dataset = this.cached_dataset;
  } else {
    this.working_dataset = util.asdata(this.dataset);
  }

  this.result_dataset = [];
  this.result_scores = [];

  util.startBackgroundTask("fillTable", this.fillTableStep, this);
};

Completer.prototype.fillTableStep = function(join) {
  var str = this.working_str;
  var idx = this.working_idx;

  if (str == "") {
    this.fillTableStepEmptyShortcut();
    return false;
  }

  var n = this.working_dataset.length;
  var quota = join ? -1 : 1000;
  for (; idx < n && quota; ++idx, --quota) {
    var datarow = this.working_dataset[idx];
    var datarow_shown = this.dataset_ids.map(function(name) {
        return datarow[name] || ""; });
    var score = util.idoMatch(str, datarow_shown);
    if (score < 0) {
      continue;
    }
    this.result_scores.push([score, datarow, datarow_shown]);
    this.result_dataset.push(datarow);
  }

  if (idx < n) {
    // Didn't finish yet, but our work slice has expired.
    // Save the working position and "yield".
    this.working_idx = idx;
    return true;
  }

  // Finished the scoring. Sort the result, update the cached values
  // and finish the fillTable.

  this.result_scores.sort(function (a,b) { return b[0] - a[0]; });
  this.cached_table = this.result_scores.slice(0, this.maxResults);
  this.cached_dataset = this.result_dataset;
  this.cached_str = str;

  this.fillTableEnd(str);
  return false;
};

Completer.prototype.fillTableStepEmptyShortcut = function() {
  var self = this;
  this.cached_table = this.working_dataset.slice(0, this.maxResults).map(
      function(datarow) {
        var datarow_shown = self.dataset_ids.map(function(name) {
            return datarow[name] || ""; });
        return [0, datarow, datarow_shown];
      });
  this.cached_dataset = this.working_dataset;
  this.cached_str = "";

  this.fillTableEnd("");
};

Completer.prototype.joinFillTable = function() {
  if (this.pendingFillReqId !== null) {
    // There is a fillTable request pending, start it right now.
    this.requestFillTable(true);
    // TODO(klao): it's a bit silly to start the async process to
    // which we will join immediately. But the waste is minimal: a
    // single posted message will be discarded (worst case).
  }
  util.joinBackgroundTask("fillTable");
};

Completer.prototype.invalidateCache = function() {
  this.cached_str = undefined;
};

Completer.prototype.fillTableEnd = function(str) {
  var self = this;
  var ui = self.compui;

  ui.html(""); // remove the current completion table
  var header_row = $("<tr/>");
  for (var i in self.dataset_labels) {
    header_row.append($("<th>" + this.dataset_labels[i] + "</th>"));
  }
  ui.append(header_row);

  var user_row = $("<tr/>");
  var user_field = $("<td/>");
  user_field.text(str).attr('colspan', self.dataset_labels.length);
  user_row.append(user_field);
  if (!str)
    user_field.text(this.emptyText);
  ui.append(user_row);
  user_row.click(function () { self.complete(true, 0); });

  this.cached_table.forEach(function (r, i) {
      var datarow_shown = r[2];
      var row = $("<tr/>");
      datarow_shown.forEach(function(x) {
          row.append($("<td/>").text(x));
        });
      row.click(function () { self.complete(true, i+1); });
      ui.append(row);
    });

  ui.find("tr").removeClass("selected");
  var items = ui.find("tr");
  this.cursor.reset($(items[1]), $(items[items.length-1]), items.length-1);

  this.working_str = undefined;
};


Completer.prototype.appendTo = function(input_container) {
  this.__super.prototype.appendTo.apply(this, arguments);
  $("#completiontable").append(this.compui);
};

Completer.prototype.pendingFillReqHandlerBindme = function() {
  this.fillTableStart($.trim(this.inputhandler.val()));
  this.pendingFillReqId = null;
};

Completer.prototype.requestFillTable = function(immediately) {
  if (this.pendingFillReqId) {
    util.cancelTimer(this.pendingFillReqId);
  }
  if (!immediately) {
    this.pendingFillReqId = util.timer(100, this.pendingFillReqHandler);
  } else {
    this.pendingFillReqHandler();
  }
};

Completer.prototype.requestComplete = function(focusafter) {
  this.joinFillTable();
  this.complete(focusafter);
};

Completer.prototype.inputHandlerKeypressBindme = function (event) {
  if (event.which == 13) { // enter
    this.requestComplete(true);
    return false;
  }
  // fox has 0 here if the keypress is not giving real input, not
  // changing the text (down, up, etc.)
  if (event.which != 0)
    this.requestFillTable();

  // This means that the browser should handle this keypress in its
  // own ways: the input character should appear in the textbox and
  // browser shortcuts should work (f5, ctrl-t, etc.)
  return true;
};

Completer.prototype.inputHandlerKeydownBindme = function (event) {
  // TODO(baldvin): http://stackoverflow.com/questions/1465374/javascript-event-keycode-constants
  // TODO(errge): tab handling, simple approach is racy and buggy, but why?
  // if (event.which == 9 && event.shiftKey == false) {
  //   // TAB, can't be handled together with 13 in Keypress, because
  //   // neither FF nor Chrome emits keypress for TAB
  //   this.requestComplete(true);
  //   return false;
  // }
  if (event.which == 8 || event.which == 46) {
    // backspace and delete is handled here as special keys, since
    // Chrome doesn't emit keypressed for changes with these keys.
    this.requestFillTable();
  }
  if (event.which == 38) {
    this.joinFillTable();
    this.cursor.prev();
    return false;
  }
  if (event.which == 40) {
    this.joinFillTable();
    this.cursor.next();
    return false;
  }
  return true;
};

////////////////////////////////////////////////////////////////////////////////
// Slinglet


/**
 * Interactive bookmark UI, a collection of input boxes
 * (maybe with completion) and the function to compute the target URL
 * when the user is finished.
 * @param {Function} handlerFn Called when the user is finished.
 * @param {Function} fieldCreater Lazy array of InputBoxes and Completers.
 * @param {Array.<string>} dependencies Javascript files to start
 *               loading when the UI is used first.
 * @constructor
 */
function Slinglet(handlerFn, fieldCreater, dependencies) {
  this.handlerFn = handlerFn;
  this.fieldCreater = fieldCreater;
  this.dependencies = dependencies;
};

Slinglet.prototype.activate = function() {
  if (!this.fields) {
    this.fields = util.asarray(this.fieldCreater.call());

    var span = $("<span>");
    this.inputs = span;
    var self = this;
    for (var i = 0; i < this.fields.length; ++i) {
      this.fields[i].appendTo(span);
      if (i + 1 < this.fields.length) {
        (function(){
           var nextField = self.fields[i+1];
           self.fields[i].action =
             function() {
               nextField.inputhandler.focus();
               nextField.inputui.focusin();  // firefox & chrome bug
             };
           })();
      } else {
        var lastField = this.fields[i];
        lastField.action = function() {
          self.handlerFn.apply(self,
                               $.map(span.find("input"),
                               function(o) { return $.trim(o.value); }));
      };
      }
    }
    $("#inputfields").append(span);
  } else {
    this.inputs.show();
  }
  this.fields[0].inputhandler.focus();
  this.fields[0].inputui.focusin(); // firefox bug (chrome too?)

  if (this.dependencies && !this.dependenciesLoaded) {
    util.load(this.dependencies, util.bind(this.activateLoaded, this));
  } else {
    this.activateLoaded();
  }
};

Slinglet.prototype.activateLoaded = function() {
  this.dependenciesLoaded = true;
  this.fields.forEach(function(completer) {
      if (completer.invalidateCache)
        completer.invalidateCache();
    });
  $(document.activeElement).focusin();
};