var ExtensionClass = function () {};
ExtensionClass.prototype = {
  run: function (arguments) {
    arguments.completionFunction({
      title: document.title || document.querySelector('meta[property="og:title"]')?.getAttribute('content') || `${location.href}${location.pathname}`,
      url: document.URL,
      content: ''
    });
  }
};
var ExtensionPreprocessingJS = new ExtensionClass;
