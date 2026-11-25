# Reader appearance prototype

This is a design handoff, not a shipped Web or Mobile feature. The prototype overlays proposed controls on existing reader screenshots. It does not change a real article or save user preferences.

To open the prototype offline, copy `index.html` to an empty folder, put the three PNG baselines below beside it using the names in the first column, and open the HTML in a browser. No server, dependencies or credentials are required. The screenshots are visual evidence and are intentionally not committed; obtain the originals from the UX audit or the change requester.

| Name beside the HTML | Source in the local UX audit |
| --- | --- |
| `web-reader.png` | `ux-audit-webext-1124/web/09-reader.png` |
| `ios-reader.png` | `ux-audit-current/mobile/ios-native-control/evidence/reader-starred-and-restored.png` |
| `ios-menu.png` | `ux-audit-current/mobile/ios-native-control/evidence/reader-header-more-menu.png` |

Select Web or iPhone, compare the original menu with the proposed entry, then open the appearance controls. The Web menu adds one row; the iPhone sheet uses the empty fourth tile in the second row. The prototype covers four paper choices, four ink choices including automatic, three sizes and three typefaces. Android is in the implementation scope, not pictured in this prototype.
