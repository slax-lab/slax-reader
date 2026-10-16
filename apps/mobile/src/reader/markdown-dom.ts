export const markdownDomScript = `
(function () {
  var previous = [], queued = null;
  function apply(blocks) {
    var selection = window.getSelection();
    if (selection && !selection.isCollapsed) { queued = blocks; return; }
    queued = null;
    var start = 0, end = 0;
    while (start < previous.length && start < blocks.length && previous[start] === blocks[start]) start++;
    if (start === previous.length && start === blocks.length) return;
    while (end < previous.length - start && end < blocks.length - start && previous[previous.length - 1 - end] === blocks[blocks.length - 1 - end]) end++;
    var content = document.getElementById('content'), old = Array.from(content.children), y = window.scrollY;
    var anchor = old[old.length - end] || null;
    for (var i = start; i < old.length - end; i++) content.removeChild(old[i]);
    var fragment = document.createDocumentFragment();
    for (var j = start; j < blocks.length - end; j++) {
      var template = document.createElement('template');
      template.innerHTML = blocks[j];
      fragment.appendChild(template.content);
    }
    content.insertBefore(fragment, anchor);
    previous = blocks;
    window.scrollTo(0, y);
  }
  window.__slaxOutlineUpdate = apply;
  document.addEventListener('selectionchange', function () {
    var selection = window.getSelection();
    if (queued !== null && (!selection || selection.isCollapsed)) apply(queued);
  });
  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a');
    if (!link) return;
    event.preventDefault();
    window.ReactNativeWebView.postMessage(JSON.stringify({type: 'link', href: link.getAttribute('href')}));
  });
})();`;
