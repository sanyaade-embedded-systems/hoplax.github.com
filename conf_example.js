hoplax.imports = [
        // '../userbookmarks.js',
        'builtins.js',
        null // Convenience, so you can have commas at the end of every line.
];

// Simply jump to the url given, no Google search possible.
//
// hoplax.bookmark_completer.plainHandlers = function(s) {
//   if (s == '')
//     return [];
//   else
//     return [
//       {
//         s: 'Jump to: ' + hoplax.urlize(s),
//         f: function() {
//           window.location = hoplax.urlize(s);
//         }
//       }
//     ];
// };

$(document).ready(hoplax.init);
