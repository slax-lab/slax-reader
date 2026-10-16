/* Application-owned React Native transport around the unchanged source reader bridge. */
(function installSlaxReaderHost(configuration) {
    'use strict';
    var active = true;
    var requestFrame = null;
    var observer = null;
    var latestTouchClientY = null;
    var scrollEnabled = configuration.platform === 'ios';
    var listeners = [];
    var previousHeight = -1;
    var initializedUserId = null;
    var contextualManager = null;
    var inputSoon = null, inputAfterSelection = null, inputStart = null;
    var inputState = { sequence: 0, touchStarts: 0, touchEnds: 0, touchCancels: 0, clicks: 0, selectionChanges: 0,
        bubbleTouchStarts: 0, bubbleTouchEnds: 0, bubbleTouchCancels: 0,
        sourceMarkClicks: 0, sourceSelections: 0, sourceDeselections: 0, sourceErrors: 0,
        lastDomEventCode: 0, lastSourceEventCode: 0, lastTouchCount: 0, lastTouchHadStart: false, lastTouchRangePresent: false, lastTouchRangeCollapsed: null,
        lastTouchMovedX: null, lastTouchMovedY: null, lastTargetClosestMark: false, lastHitClosestMark: false,
        lastMarkInfoPresent: false, lastMarkCommentCount: 0 };
    function inputCount(value) { return Math.min(Math.max(value, 0), 1000000); }
    function inputCode(type) { return ['markClicked', 'textSelected', 'textDeselected', 'markItemInfosChanged', 'tap', 'selectionError'].indexOf(type) + 1; }
    function inputSnapshot() {
        var bridge = window.SlaxWebViewBridge, monitor = bridge && bridge.selectionMonitor;
        var selection = window.getSelection(), range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
        return Object.assign({}, inputState, {
            monitorPresent: Boolean(monitor), monitoring: Boolean(monitor && monitor.isMonitoring),
            pointerDown: Boolean(monitor && monitor.isPointerDown), pendingSelection: Boolean(monitor && monitor.hasPendingSelection),
            selectionTimerActive: Boolean(monitor && monitor.selectionChangeTimeout),
            lastSelectionTextLength: inputCount(monitor ? monitor.lastSelectionText.length : 0),
            rangePresent: Boolean(range), rangeCollapsed: range ? range.collapsed : null,
            rangeInsideMonitor: Boolean(monitor && range && monitor.container.contains(range.commonAncestorContainer)),
            rangeSuppressed: Boolean(monitor && range && monitor.isSuppressedSelection(range)),
        });
    }
    function scheduleInput(afterSelection) {
        if (configuration.observeInput !== true || !active) return;
        var emit = function() {
            if (!active) return;
            try { post({type: 'inputObservation', snapshot: inputSnapshot()}); } catch (_) {}
        };
        if (inputSoon === null) inputSoon = setTimeout(function() { inputSoon = null; emit(); }, 0);
        if (afterSelection) {
            if (inputAfterSelection !== null) clearTimeout(inputAfterSelection);
            inputAfterSelection = setTimeout(function() { inputAfterSelection = null; emit(); }, 350);
        }
    }
    function observeInputEvent(event, key, code) {
        // Read-only capture precedes the unchanged source listeners. Deferred
        // snapshots show their resulting guards; never dispatch/process a range.
        try {
            inputState.sequence = inputCount(inputState.sequence + 1);
            inputState[key] = inputCount(inputState[key] + 1);
            inputState.lastDomEventCode = code;
            if (code <= 3) {
                var touches = code === 1 ? event.touches : event.changedTouches;
                var touch = touches && touches[0];
                inputState.lastTouchCount = inputCount(touches ? touches.length : 0);
                var selection = window.getSelection(), range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
                inputState.lastTouchRangePresent = Boolean(range);
                inputState.lastTouchRangeCollapsed = range ? range.collapsed : null;
                if (code === 1) inputStart = touches && touches.length === 1 ? {x: touch.clientX, y: touch.clientY} : null;
                inputState.lastTouchHadStart = Boolean(inputStart);
                inputState.lastTouchMovedX = touch && inputStart ? inputCount(Math.abs(touch.clientX - inputStart.x)) : null;
                inputState.lastTouchMovedY = touch && inputStart ? inputCount(Math.abs(touch.clientY - inputStart.y)) : null;
                var mark = event.target && typeof event.target.closest === 'function' ? event.target.closest('slax-mark') : null;
                var hit = touch && typeof document.elementFromPoint === 'function' ? document.elementFromPoint(touch.clientX, touch.clientY) : null;
                var hitMark = hit && typeof hit.closest === 'function' ? hit.closest('slax-mark') : null;
                var manager = window.SlaxWebViewBridge && window.SlaxWebViewBridge.markManager;
                var info = mark && manager ? manager.getMarkItemInfoByUuid(mark.dataset.uuid) : null;
                inputState.lastTargetClosestMark = Boolean(mark);
                inputState.lastHitClosestMark = Boolean(mark && hitMark && mark.dataset.uuid === hitMark.dataset.uuid);
                inputState.lastMarkInfoPresent = Boolean(info);
                inputState.lastMarkCommentCount = inputCount(info ? info.comments.length : 0);
                if (code !== 1) inputStart = null;
            }
            scheduleInput(code === 5);
        } catch (_) { /* Diagnostics cannot interrupt native touch dispatch. */ }
    }

    function post(payload) {
        if (!active || window.top !== window || !window.ReactNativeWebView) return;
        if (payload.type === 'textSelected') {
            var selection = window.getSelection();
            var range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
            var rect = range && range.getBoundingClientRect();
            payload.selectionGeometry = {
                touchClientY: latestTouchClientY,
                top: rect ? rect.top : null,
                bottom: rect ? rect.bottom : null,
            };
        }
        window.ReactNativeWebView.postMessage(JSON.stringify({
            channel: 'slax-reader',
            pageId: configuration.pageId,
            payload: payload,
        }));
        if (configuration.observeInput === true && payload.type !== 'inputObservation') {
            var code = inputCode(payload.type);
            if (code) {
                inputState.lastSourceEventCode = code;
                var key = {1: 'sourceMarkClicks', 2: 'sourceSelections', 3: 'sourceDeselections', 6: 'sourceErrors'}[code];
                if (key) inputState[key] = inputCount(inputState[key] + 1);
                scheduleInput(false);
            }
        }
    }

    // The original bridge deliberately branches by platform. Keep that behavior.
    if (configuration.platform === 'android') {
        window.NativeBridge = { postMessage: function(message) { post(JSON.parse(message)); } };
    } else {
        // WKWebView exposes readonly native namespaces. Initialize only a missing
        // browser-test namespace; assigning the existing getter aborts this script.
        if (!window.webkit) window.webkit = {};
        if (!window.webkit.messageHandlers) window.webkit.messageHandlers = {};
        window.webkit.messageHandlers.NativeBridge = {
            postMessage: function(message) { post(JSON.parse(message)); },
        };
    }

    function listen(target, event, handler, options) {
        target.addEventListener(event, handler, options);
        listeners.push(function() { target.removeEventListener(event, handler, options); });
    }
    function height() {
        return Math.max(document.body ? document.body.scrollHeight : 0,
            document.body ? document.body.offsetHeight : 0, document.documentElement.scrollHeight);
    }
    function measure() {
        requestFrame = null;
        if (!active) return;
        var contentHeight = height();
        if (contentHeight !== previousHeight) {
            previousHeight = contentHeight;
            post({ type: 'contentHeight', height: contentHeight });
        }
        if (scrollEnabled) post({
            type: 'documentScroll',
            scrollY: window.scrollY || document.documentElement.scrollTop || 0,
            contentHeight: contentHeight,
            viewportHeight: window.innerHeight,
        });
    }
    function scheduleMeasure() {
        if (requestFrame === null && active) requestFrame = window.requestAnimationFrame(measure);
    }
    function begin() {
        if (!active) return;
        if (configuration.observeInput === true) {
            [['touchstart', 'touchStarts', 1], ['touchend', 'touchEnds', 2], ['touchcancel', 'touchCancels', 3],
                ['click', 'clicks', 4], ['selectionchange', 'selectionChanges', 5]].forEach(function(binding) {
                listen(document, binding[0], function(event) { observeInputEvent(event, binding[1], binding[2]); }, {capture: true, passive: true});
            });
            [['touchstart', 'bubbleTouchStarts'], ['touchend', 'bubbleTouchEnds'], ['touchcancel', 'bubbleTouchCancels']].forEach(function(binding) {
                listen(document, binding[0], function() {
                    inputState[binding[1]] = inputCount(inputState[binding[1]] + 1);
                    scheduleInput(false);
                }, {passive: true});
            });
            scheduleInput(false);
        }
        // Source BackgroundDomain rewrites only image transports before WebView loading.
        // Do this in place: retain the document nodes used by historical CSS-path marks.
        if (configuration.rewriteImageTransports !== false) document.querySelectorAll('img').forEach(function(image) {
            var source = image.getAttribute('src') || '';
            if (/^https:\/\//i.test(source)) image.setAttribute('src', source.replace(/^https:\/\//i, 'slaxstatics://'));
            else if (/^http:\/\//i.test(source)) image.setAttribute('src', source.replace(/^http:\/\//i, 'slaxstatic://'));
        });
        scheduleMeasure();
        if (window.ResizeObserver) {
            observer = new ResizeObserver(scheduleMeasure);
            observer.observe(document.body);
        }
        listen(document, 'load', scheduleMeasure, true);
        listen(window, 'resize', scheduleMeasure, { passive: true });
        listen(window, 'scroll', scheduleMeasure, { passive: true });
        listen(document, 'touchstart', function(event) {
            if (event.touches.length === 1) latestTouchClientY = event.touches[0].clientY;
        }, { passive: true });
        var start = null;
        listen(document, 'touchstart', function(event) {
            var touch = event.touches[0];
            start = touch ? { x: touch.clientX, y: touch.clientY } : null;
        }, { passive: true });
        listen(document, 'touchend', function(event) {
            var touch = event.changedTouches[0];
            var selection = window.getSelection();
            if (touch && start && Math.abs(touch.clientX - start.x) < 10 &&
                Math.abs(touch.clientY - start.y) < 10 && (!selection || selection.isCollapsed)) {
                post({ type: 'tap' });
            }
            start = null;
        }, { passive: true });
    }

    function teardown() {
        if (!active) return;
        window.SlaxWebViewBridge && window.SlaxWebViewBridge.clearSelection();
        window.SlaxWebViewBridge && window.SlaxWebViewBridge.stopSelectionMonitoring();
        if (requestFrame !== null) window.cancelAnimationFrame(requestFrame);
        requestFrame = null;
        if (inputSoon !== null) clearTimeout(inputSoon);
        if (inputAfterSelection !== null) clearTimeout(inputAfterSelection);
        inputSoon = inputAfterSelection = null;
        if (observer) observer.disconnect();
        observer = null;
        listeners.splice(0).forEach(function(remove) { remove(); });
        // Stop the article/player before the native view releases its cached requests.
        document.querySelectorAll('video, audio').forEach(function(media) { media.pause(); });
        document.querySelectorAll('iframe').forEach(function(frame) {
            try {
                var origin = new URL(frame.src).origin;
                if (origin === 'https://www.youtube.com' || origin === 'https://www.youtube-nocookie.com') {
                    frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), origin);
                }
            } catch (_) {}
        });
        active = false;
    }

    function installContextualRendering(bridge) {
        var manager = bridge.markManager;
        if (!manager || contextualManager === manager) return;
        contextualManager = manager;
        var renderer = manager.renderer;
        var original = renderer.drawMark;
        renderer.drawMark = function(id, paths, isStroke, hasComment, userId) {
            var resolvedPaths = paths;
            var info = manager.getMarkItemInfoByUuid(id);
            // Keep persisted source/group identity intact. Only rendering uses recovered paths.
            if (info && info.approx && info.approx.exact &&
                (!paths.length || !paths.every(function(path) { return renderer.transferNodeInfos(path).length > 0; }))) {
                var range = manager.getRangeFromApprox(info.approx);
                if (range) resolvedPaths = manager.buildPathsFromSelectionInfo(manager.getSelectionInfoFromRange(range));
            }
            return original.call(renderer, id, resolvedPaths, isStroke, hasComment, userId);
        };
    }

    window.__SlaxReaderHost = {
        execute: function(request) {
            if (!active || request.pageId !== configuration.pageId) return;
            var value = null;
            try {
                var bridge = window.SlaxWebViewBridge;
                if (!bridge) throw new Error('Reader bridge is not ready');
                switch (request.operation) {
                    case 'initialize':
                        if (initializedUserId !== request.argument.currentUserId || !bridge.selectionMonitor) {
                            bridge.startSelectionMonitoring('body', request.argument.currentUserId);
                            initializedUserId = request.argument.currentUserId;
                        }
                        installContextualRendering(bridge);
                        if (request.argument.infoPack) bridge.receiveInfoPack(JSON.stringify(request.argument.infoPack));
                        break;
                    case 'clearSelection': bridge.clearSelection(); break;
                    case 'captureSelection': value = bridge.captureCurrentSelection(); break;
                    case 'drawMarks': value = bridge.drawMarks(JSON.stringify(request.argument)); break;
                    case 'scrollToAnchor': value = bridge.scrollToAnchor(request.argument); break;
                    case 'scrollTo':
                        window.scrollTo({ top: request.argument.y, behavior: request.argument.animated ? 'smooth' : 'instant' });
                        break;
                    case 'seekYoutube':
                        if (!window.__slaxSeekYoutube) throw new Error('YouTube player is unavailable');
                        window.__slaxSeekYoutube(request.argument);
                        break;
                    case 'queryImageUrls':
                        value = Array.from(document.querySelectorAll('img')).map(function(image) { return image.getAttribute('src') || ''; })
                            .filter(function(url) { return url && !url.startsWith('data:'); });
                        break;
                    case 'queryYoutubeTime':
                        value = window.__slaxGetYoutubeTime ? window.__slaxGetYoutubeTime() : -1;
                        break;
                    case 'prepareFixture':
                        if (configuration.controlledFixture !== true) throw new Error('Fixture document commands are disabled');
                        var action = request.argument;
                        if (action.kind === 'selection') {
                            if (!Array.isArray(action.source) || !action.source.length) throw new Error('Fixture selection requires source paths');
                            var nodes = action.source.flatMap(function(path) { return bridge.markManager.renderer.transferNodeInfos(path); });
                            if (!nodes.length || nodes.some(function(info) { return info.type !== 'text'; })) throw new Error('Fixture text range did not resolve');
                            var first = nodes[0], last = nodes[nodes.length - 1];
                            var range = document.createRange(); range.setStart(first.node, first.start); range.setEnd(last.node, last.end);
                            if (typeof action.selectedText === 'string' && range.toString() !== action.selectedText) throw new Error('Fixture selected text does not match the document');
                            window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
                            document.dispatchEvent(new Event('selectionchange'));
                        } else if (action.kind === 'open-comment') {
                            if (!Number.isSafeInteger(action.markId)) throw new Error('Invalid fixture mark id');
                            bridge.clearSelection();
                            var group = bridge.markManager.markItemInfos.find(function(info) {
                                return info.comments.some(function(comment) { return comment.markId === action.markId; });
                            });
                            var mark = group && Array.from(document.querySelectorAll('slax-mark[data-uuid]')).find(function(element) {
                                return element.dataset.uuid === group.id;
                            });
                            if (!mark) throw new Error('Fixture mark did not resolve');
                            var start = new Event('touchstart', {bubbles: true}); Object.defineProperty(start, 'touches', {value: [{clientX: 0, clientY: 0}]});
                            var end = new Event('touchend', {bubbles: true}); Object.defineProperty(end, 'changedTouches', {value: [{clientX: 0, clientY: 0}]});
                            mark.dispatchEvent(start); mark.dispatchEvent(end);
                        } else if (action.kind === 'open-image') {
                            var image = document.getElementById(action.imageId);
                            if (!image || image.tagName !== 'IMG') throw new Error('Fixture image did not resolve');
                            image.click();
                        } else if (action.kind === 'inspect-selection') {
                            // Read-only state for a controlled native rejection. Do
                            // not release a pointer, process a selection or publish it.
                            var monitor = bridge.selectionMonitor;
                            var currentSelection = window.getSelection();
                            var currentRange = currentSelection && currentSelection.rangeCount ? currentSelection.getRangeAt(0) : null;
                            var bounds = currentRange && currentRange.getBoundingClientRect();
                            value = {
                                monitorPresent: Boolean(monitor), monitoring: Boolean(monitor && monitor.isMonitoring),
                                pointerDown: Boolean(monitor && monitor.isPointerDown), pendingSelection: Boolean(monitor && monitor.hasPendingSelection),
                                selectionTimerActive: Boolean(monitor && monitor.selectionChangeTimeout),
                                lastSelectionTextLength: monitor ? monitor.lastSelectionText.length : 0,
                                rangePresent: Boolean(currentRange), rangeCollapsed: currentRange ? currentRange.collapsed : null,
                                rangeInsideMonitor: Boolean(monitor && currentRange && monitor.container.contains(currentRange.commonAncestorContainer)),
                                rangeSuppressed: Boolean(monitor && currentRange && monitor.isSuppressedSelection(currentRange)),
                                iosSourceBridgePresent: Boolean(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.NativeBridge),
                                rangeClientBounds: bounds ? {top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right} : null,
                            };
                        } else throw new Error('Unsupported fixture document action');
                        break;
                    case 'teardown':
                        // Acknowledge before shutting down the transport.
                        post({ type: 'commandResult', requestId: request.requestId, value: null });
                        teardown();
                        return;
                    default: throw new Error('Unsupported reader command');
                }
                post({ type: 'commandResult', requestId: request.requestId, value: value });
            } catch (error) {
                // Do not include article, annotation, or credential contents in diagnostics.
                post({ type: 'commandResult', requestId: request.requestId,
                    error: error instanceof Error ? error.message : 'Reader command failed' });
            }
        },
        teardown: teardown,
    };
    if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', begin, { once: true });
    else begin();
    listen(window, 'pagehide', teardown, { once: true });
})(__SLAX_READER_CONFIGURATION__);
