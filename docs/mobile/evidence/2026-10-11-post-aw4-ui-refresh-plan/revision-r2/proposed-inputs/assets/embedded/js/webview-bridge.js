var SlaxReaderWebBridgeExports = (function (exports) {
    'use strict';

    function detectPlatform() {
        // Android 平台：检查 NativeBridge.postMessage 是否存在
        if (window.NativeBridge?.postMessage) {
            return 'android';
        }
        // iOS 平台：检查 webkit.messageHandlers.NativeBridge 是否存在
        if (window.webkit?.messageHandlers?.NativeBridge) {
            return 'ios';
        }
        return 'unknown';
    }

    /**
     * 发送消息给 Native
     */
    function postToNativeBridge(payload) {
        const message = JSON.stringify(payload);
        const platform = detectPlatform();
        // Android 平台
        if (platform === 'android') {
            window.NativeBridge.postMessage(message);
            return true;
        }
        // iOS 平台
        if (platform === 'ios') {
            window.webkit.messageHandlers.NativeBridge.postMessage(message);
            return true;
        }
        console.warn('[NativeBridge] Native bridge not available, platform:', platform);
        return false;
    }

    /**
     * 获取页面内容高度
     */
    function getContentHeight() {
        return Math.max(document.body.scrollHeight, document.body.offsetHeight, document.documentElement.clientHeight, document.documentElement.scrollHeight, document.documentElement.offsetHeight);
    }

    /**
     * 高亮目标元素
     */
    function highlightElement(target) {
        let element = null;
        let range = null;
        if (target instanceof HTMLElement || target === null) {
            element = target;
        }
        else {
            element = target.element || null;
            range = target.range || null;
        }
        if (!element && !range) {
            console.warn('[WebView Bridge] Target element/range does not exist, cannot highlight');
            return;
        }
        try {
            const selection = window.getSelection();
            if (!range && element) {
                range = document.createRange();
                range.selectNodeContents(element);
            }
            if (selection && range) {
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }
        catch (error) {
            console.warn('[WebView Bridge] Failed to select element:', error);
        }
    }

    /**
     * Implementation of Myers' online approximate string matching algorithm [1],
     * with additional optimizations suggested by [2].
     *
     * This has O((k/w) * n) expected-time where `n` is the length of the
     * text, `k` is the maximum number of errors allowed (always <= the pattern
     * length) and `w` is the word size. Because JS only supports bitwise operations
     * on 32 bit integers, `w` is 32.
     *
     * As far as I am aware, there aren't any online algorithms which are
     * significantly better for a wide range of input parameters. The problem can be
     * solved faster using "filter then verify" approaches which first filter out
     * regions of the text that cannot match using a "cheap" check and then verify
     * the remaining potential matches. The verify step requires an algorithm such
     * as this one however.
     *
     * The algorithm's approach is essentially to optimize the classic dynamic
     * programming solution to the problem by computing columns of the matrix in
     * word-sized chunks (ie. dealing with 32 chars of the pattern at a time) and
     * avoiding calculating regions of the matrix where the minimum error count is
     * guaranteed to exceed the input threshold.
     *
     * The paper consists of two parts, the first describes the core algorithm for
     * matching patterns <= the size of a word (implemented by `advanceBlock` here).
     * The second uses the core algorithm as part of a larger block-based algorithm
     * to handle longer patterns.
     *
     * [1] G. Myers, “A Fast Bit-Vector Algorithm for Approximate String Matching
     * Based on Dynamic Programming,” vol. 46, no. 3, pp. 395–415, 1999.
     *
     * [2] Šošić, M. (2014). An simd dynamic programming c/c++ library (Doctoral
     * dissertation, Fakultet Elektrotehnike i računarstva, Sveučilište u Zagrebu).
     */
    function reverse(s) {
        return s.split("").reverse().join("");
    }
    /**
     * Given the ends of approximate matches for `pattern` in `text`, find
     * the start of the matches.
     *
     * @param findEndFn - Function for finding the end of matches in
     * text.
     * @return Matches with the `start` property set.
     */
    function findMatchStarts(text, pattern, matches) {
        const patRev = reverse(pattern);
        return matches.map((m) => {
            // Find start of each match by reversing the pattern and matching segment
            // of text and searching for an approx match with the same number of
            // errors.
            const minStart = Math.max(0, m.end - pattern.length - m.errors);
            const textRev = reverse(text.slice(minStart, m.end));
            // If there are multiple possible start points, choose the one that
            // maximizes the length of the match.
            const start = findMatchEnds(textRev, patRev, m.errors).reduce((min, rm) => {
                if (m.end - rm.end < min) {
                    return m.end - rm.end;
                }
                return min;
            }, m.end);
            return {
                start,
                end: m.end,
                errors: m.errors,
            };
        });
    }
    /**
     * Return 1 if a number is non-zero or zero otherwise, without using
     * conditional operators.
     *
     * This should get inlined into `advanceBlock` below by the JIT.
     *
     * Adapted from https://stackoverflow.com/a/3912218/434243
     */
    function oneIfNotZero(n) {
        return ((n | -n) >> 31) & 1;
    }
    /**
     * Block calculation step of the algorithm.
     *
     * From Fig 8. on p. 408 of [1], additionally optimized to replace conditional
     * checks with bitwise operations as per Section 4.2.3 of [2].
     *
     * @param ctx - The pattern context object
     * @param peq - The `peq` array for the current character (`ctx.peq.get(ch)`)
     * @param b - The block level
     * @param hIn - Horizontal input delta ∈ {1,0,-1}
     * @return Horizontal output delta ∈ {1,0,-1}
     */
    function advanceBlock(ctx, peq, b, hIn) {
        let pV = ctx.P[b];
        let mV = ctx.M[b];
        const hInIsNegative = hIn >>> 31; // 1 if hIn < 0 or 0 otherwise.
        const eq = peq[b] | hInIsNegative;
        // Step 1: Compute horizontal deltas.
        const xV = eq | mV;
        const xH = (((eq & pV) + pV) ^ pV) | eq;
        let pH = mV | ~(xH | pV);
        let mH = pV & xH;
        // Step 2: Update score (value of last row of this block).
        const hOut = oneIfNotZero(pH & ctx.lastRowMask[b]) -
            oneIfNotZero(mH & ctx.lastRowMask[b]);
        // Step 3: Update vertical deltas for use when processing next char.
        pH <<= 1;
        mH <<= 1;
        mH |= hInIsNegative;
        pH |= oneIfNotZero(hIn) - hInIsNegative; // set pH[0] if hIn > 0
        pV = mH | ~(xV | pH);
        mV = pH & xV;
        ctx.P[b] = pV;
        ctx.M[b] = mV;
        return hOut;
    }
    /**
     * Find the ends and error counts for matches of `pattern` in `text`.
     *
     * Only the matches with the lowest error count are reported. Other matches
     * with error counts <= maxErrors are discarded.
     *
     * This is the block-based search algorithm from Fig. 9 on p.410 of [1].
     */
    function findMatchEnds(text, pattern, maxErrors) {
        if (pattern.length === 0) {
            return [];
        }
        // Clamp error count so we can rely on the `maxErrors` and `pattern.length`
        // rows being in the same block below.
        maxErrors = Math.min(maxErrors, pattern.length);
        const matches = [];
        // Word size.
        const w = 32;
        // Index of maximum block level.
        const bMax = Math.ceil(pattern.length / w) - 1;
        // Context used across block calculations.
        const ctx = {
            P: new Uint32Array(bMax + 1),
            M: new Uint32Array(bMax + 1),
            lastRowMask: new Uint32Array(bMax + 1),
        };
        ctx.lastRowMask.fill(1 << 31);
        ctx.lastRowMask[bMax] = 1 << (pattern.length - 1) % w;
        // Dummy "peq" array for chars in the text which do not occur in the pattern.
        const emptyPeq = new Uint32Array(bMax + 1);
        // Map of UTF-16 character code to bit vector indicating positions in the
        // pattern that equal that character.
        const peq = new Map();
        // Version of `peq` that only stores mappings for small characters. This
        // allows faster lookups when iterating through the text because a simple
        // array lookup can be done instead of a hash table lookup.
        const asciiPeq = [];
        for (let i = 0; i < 256; i++) {
            asciiPeq.push(emptyPeq);
        }
        // Calculate `ctx.peq` - a map of character values to bitmasks indicating
        // positions of that character within the pattern, where each bit represents
        // a position in the pattern.
        for (let c = 0; c < pattern.length; c += 1) {
            const val = pattern.charCodeAt(c);
            if (peq.has(val)) {
                // Duplicate char in pattern.
                continue;
            }
            const charPeq = new Uint32Array(bMax + 1);
            peq.set(val, charPeq);
            if (val < asciiPeq.length) {
                asciiPeq[val] = charPeq;
            }
            for (let b = 0; b <= bMax; b += 1) {
                charPeq[b] = 0;
                // Set all the bits where the pattern matches the current char (ch).
                // For indexes beyond the end of the pattern, always set the bit as if the
                // pattern contained a wildcard char in that position.
                for (let r = 0; r < w; r += 1) {
                    const idx = b * w + r;
                    if (idx >= pattern.length) {
                        continue;
                    }
                    const match = pattern.charCodeAt(idx) === val;
                    if (match) {
                        charPeq[b] |= 1 << r;
                    }
                }
            }
        }
        // Index of last-active block level in the column.
        let y = Math.max(0, Math.ceil(maxErrors / w) - 1);
        // Initialize maximum error count at bottom of each block.
        const score = new Uint32Array(bMax + 1);
        for (let b = 0; b <= y; b += 1) {
            score[b] = (b + 1) * w;
        }
        score[bMax] = pattern.length;
        // Initialize vertical deltas for each block.
        for (let b = 0; b <= y; b += 1) {
            ctx.P[b] = -1;
            ctx.M[b] = 0;
        }
        // Process each char of the text, computing the error count for `w` chars of
        // the pattern at a time.
        for (let j = 0; j < text.length; j += 1) {
            // Lookup the bitmask representing the positions of the current char from
            // the text within the pattern.
            const charCode = text.charCodeAt(j);
            let charPeq;
            if (charCode < asciiPeq.length) {
                // Fast array lookup.
                charPeq = asciiPeq[charCode];
            }
            else {
                // Slower hash table lookup.
                charPeq = peq.get(charCode);
                if (typeof charPeq === "undefined") {
                    charPeq = emptyPeq;
                }
            }
            // Calculate error count for blocks that we definitely have to process for
            // this column.
            let carry = 0;
            for (let b = 0; b <= y; b += 1) {
                carry = advanceBlock(ctx, charPeq, b, carry);
                score[b] += carry;
            }
            // Check if we also need to compute an additional block, or if we can reduce
            // the number of blocks processed for the next column.
            if (score[y] - carry <= maxErrors &&
                y < bMax &&
                (charPeq[y + 1] & 1 || carry < 0)) {
                // Error count for bottom block is under threshold, increase the number of
                // blocks processed for this column & next by 1.
                y += 1;
                ctx.P[y] = -1;
                ctx.M[y] = 0;
                let maxBlockScore;
                if (y === bMax) {
                    const remainder = pattern.length % w;
                    maxBlockScore = remainder === 0 ? w : remainder;
                }
                else {
                    maxBlockScore = w;
                }
                score[y] =
                    score[y - 1] +
                        maxBlockScore -
                        carry +
                        advanceBlock(ctx, charPeq, y, carry);
            }
            else {
                // Error count for bottom block exceeds threshold, reduce the number of
                // blocks processed for the next column.
                while (y > 0 && score[y] >= maxErrors + w) {
                    y -= 1;
                }
            }
            // If error count is under threshold, report a match.
            if (y === bMax && score[y] <= maxErrors) {
                if (score[y] < maxErrors) {
                    // Discard any earlier, worse matches.
                    matches.splice(0, matches.length);
                }
                matches.push({
                    start: -1,
                    end: j + 1,
                    errors: score[y],
                });
                // Because `search` only reports the matches with the lowest error count,
                // we can "ratchet down" the max error threshold whenever a match is
                // encountered and thereby save a small amount of work for the remainder
                // of the text.
                maxErrors = score[y];
            }
        }
        return matches;
    }
    /**
     * Search for matches for `pattern` in `text` allowing up to `maxErrors` errors.
     *
     * Returns the start, and end positions and error counts for each lowest-cost
     * match. Only the "best" matches are returned.
     */
    function search(text, pattern, maxErrors) {
        const matches = findMatchEnds(text, pattern, maxErrors);
        return findMatchStarts(text, pattern, matches);
    }

    var lib$1 = {};

    var lib = {};

    var hasRequiredLib$1;

    function requireLib$1 () {
    	if (hasRequiredLib$1) return lib;
    	hasRequiredLib$1 = 1;
    	(function (exports$1) {

    		Object.defineProperty(exports$1, "__esModule", {
    		  value: true
    		});
    		exports$1["default"] = seek;
    		var E_END = 'Iterator exhausted before seek ended.';
    		var E_SHOW = 'Argument 1 of seek must use filter NodeFilter.SHOW_TEXT.';
    		var E_WHERE = 'Argument 2 of seek must be an integer or a Text Node.';
    		var DOCUMENT_POSITION_PRECEDING = 2;
    		var SHOW_TEXT = 4;
    		var TEXT_NODE = 3;

    		function seek(iter, where) {
    		  if (iter.whatToShow !== SHOW_TEXT) {
    		    var error; // istanbul ignore next

    		    try {
    		      error = new DOMException(E_SHOW, 'InvalidStateError');
    		    } catch (_unused) {
    		      error = new Error(E_SHOW);
    		      error.code = 11;
    		      error.name = 'InvalidStateError';

    		      error.toString = function () {
    		        return "InvalidStateError: ".concat(E_SHOW);
    		      };
    		    }

    		    throw error;
    		  }

    		  var count = 0;
    		  var node = iter.referenceNode;
    		  var predicates = null;

    		  if (isInteger(where)) {
    		    predicates = {
    		      forward: function forward() {
    		        return count < where;
    		      },
    		      backward: function backward() {
    		        return count > where || !iter.pointerBeforeReferenceNode;
    		      }
    		    };
    		  } else if (isText(where)) {
    		    var forward = before(node, where) ? function () {
    		      return false;
    		    } : function () {
    		      return node !== where;
    		    };

    		    var backward = function backward() {
    		      return node !== where || !iter.pointerBeforeReferenceNode;
    		    };

    		    predicates = {
    		      forward: forward,
    		      backward: backward
    		    };
    		  } else {
    		    throw new TypeError(E_WHERE);
    		  }

    		  while (predicates.forward()) {
    		    node = iter.nextNode();

    		    if (node === null) {
    		      throw new RangeError(E_END);
    		    }

    		    count += node.nodeValue.length;
    		  }

    		  if (iter.nextNode()) {
    		    node = iter.previousNode();
    		  }

    		  while (predicates.backward()) {
    		    node = iter.previousNode();

    		    if (node === null) {
    		      throw new RangeError(E_END);
    		    }

    		    count -= node.nodeValue.length;
    		  }

    		  if (!isText(iter.referenceNode)) {
    		    throw new RangeError(E_END);
    		  }

    		  return count;
    		}

    		function isInteger(n) {
    		  if (typeof n !== 'number') return false;
    		  return isFinite(n) && Math.floor(n) === n;
    		}

    		function isText(node) {
    		  return node.nodeType === TEXT_NODE;
    		}

    		function before(ref, node) {
    		  return ref.compareDocumentPosition(node) & DOCUMENT_POSITION_PRECEDING;
    		}
    		
    	} (lib));
    	return lib;
    }

    var domSeek;
    var hasRequiredDomSeek;

    function requireDomSeek () {
    	if (hasRequiredDomSeek) return domSeek;
    	hasRequiredDomSeek = 1;
    	domSeek = requireLib$1()['default'];
    	return domSeek;
    }

    var rangeToString = {};

    var hasRequiredRangeToString;

    function requireRangeToString () {
    	if (hasRequiredRangeToString) return rangeToString;
    	hasRequiredRangeToString = 1;
    	(function (exports$1) {

    		Object.defineProperty(exports$1, "__esModule", {
    		  value: true
    		});
    		exports$1["default"] = rangeToString;

    		/**
    		 * Return the next node after `node` in a tree order traversal of the document.
    		 */
    		function nextNode(node, skipChildren) {
    		  if (!skipChildren && node.firstChild) {
    		    return node.firstChild;
    		  }

    		  do {
    		    if (node.nextSibling) {
    		      return node.nextSibling;
    		    }

    		    node = node.parentNode;
    		  } while (node);
    		  /* istanbul ignore next */


    		  return node;
    		}

    		function firstNode(range) {
    		  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    		    var node = range.startContainer.childNodes[range.startOffset];
    		    return node || nextNode(range.startContainer, true
    		    /* skip children */
    		    );
    		  }

    		  return range.startContainer;
    		}

    		function firstNodeAfter(range) {
    		  if (range.endContainer.nodeType === Node.ELEMENT_NODE) {
    		    var node = range.endContainer.childNodes[range.endOffset];
    		    return node || nextNode(range.endContainer, true
    		    /* skip children */
    		    );
    		  }

    		  return nextNode(range.endContainer);
    		}

    		function forEachNodeInRange(range, cb) {
    		  var node = firstNode(range);
    		  var pastEnd = firstNodeAfter(range);

    		  while (node !== pastEnd) {
    		    cb(node);
    		    node = nextNode(node);
    		  }
    		}
    		/**
    		 * A ponyfill for Range.toString().
    		 * Spec: https://dom.spec.whatwg.org/#dom-range-stringifier
    		 *
    		 * Works around the buggy Range.toString() implementation in IE and Edge.
    		 * See https://github.com/tilgovi/dom-anchor-text-position/issues/4
    		 */


    		function rangeToString(range) {
    		  // This is a fairly direct translation of the Range.toString() implementation
    		  // in Blink.
    		  var text = '';
    		  forEachNodeInRange(range, function (node) {
    		    if (node.nodeType !== Node.TEXT_NODE) {
    		      return;
    		    }

    		    var start = node === range.startContainer ? range.startOffset : 0;
    		    var end = node === range.endContainer ? range.endOffset : node.textContent.length;
    		    text += node.textContent.slice(start, end);
    		  });
    		  return text;
    		}
    		
    	} (rangeToString));
    	return rangeToString;
    }

    var hasRequiredLib;

    function requireLib () {
    	if (hasRequiredLib) return lib$1;
    	hasRequiredLib = 1;

    	Object.defineProperty(lib$1, "__esModule", {
    	  value: true
    	});
    	lib$1.fromRange = fromRange;
    	lib$1.toRange = toRange;

    	var _domSeek = _interopRequireDefault(requireDomSeek());

    	var _rangeToString = _interopRequireDefault(requireRangeToString());

    	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

    	var SHOW_TEXT = 4;

    	function fromRange(root, range) {
    	  if (root === undefined) {
    	    throw new Error('missing required parameter "root"');
    	  }

    	  if (range === undefined) {
    	    throw new Error('missing required parameter "range"');
    	  }

    	  var document = root.ownerDocument;
    	  var prefix = document.createRange();
    	  var startNode = range.startContainer;
    	  var startOffset = range.startOffset;
    	  prefix.setStart(root, 0);
    	  prefix.setEnd(startNode, startOffset);
    	  var start = (0, _rangeToString["default"])(prefix).length;
    	  var end = start + (0, _rangeToString["default"])(range).length;
    	  return {
    	    start: start,
    	    end: end
    	  };
    	}

    	function toRange(root) {
    	  var selector = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    	  if (root === undefined) {
    	    throw new Error('missing required parameter "root"');
    	  }

    	  var document = root.ownerDocument;
    	  var range = document.createRange();
    	  var iter = document.createNodeIterator(root, SHOW_TEXT);
    	  var start = selector.start || 0;
    	  var end = selector.end || start;
    	  var startOffset = start - (0, _domSeek["default"])(iter, start);
    	  var startNode = iter.referenceNode;
    	  var remainder = end - start + startOffset;
    	  var endOffset = remainder - (0, _domSeek["default"])(iter, remainder);
    	  var endNode = iter.referenceNode;
    	  range.setStart(startNode, startOffset);
    	  range.setEnd(endNode, endOffset);
    	  return range;
    	}
    	
    	return lib$1;
    }

    var domAnchorTextPosition;
    var hasRequiredDomAnchorTextPosition;

    function requireDomAnchorTextPosition () {
    	if (hasRequiredDomAnchorTextPosition) return domAnchorTextPosition;
    	hasRequiredDomAnchorTextPosition = 1;
    	domAnchorTextPosition = requireLib();
    	return domAnchorTextPosition;
    }

    var domAnchorTextPositionExports = requireDomAnchorTextPosition();

    function normalizeWithRanges(raw) {
        const ranges = [];
        const text = raw.replace(/(\s+)|([^\s])/g, (match, space, _char, offset) => {
            ranges.push({ start: offset, end: offset + match.length });
            return space ? ' ' : match;
        });
        return { text, ranges };
    }
    function findBestMatch(text, dom, fuzzy = true) {
        const normalizedText = text.trim().replace(/\s+/g, ' ');
        // 长度允许一定的错误
        const maxErrors = fuzzy ? Math.max(3, Math.floor(normalizedText.length / 3)) : 0;
        const result = { candidate: null };
        function traverse(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node;
                const isJSDOM = typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom');
                if (!isJSDOM && element.offsetHeight === 0 && element.offsetWidth === 0) {
                    return;
                }
                const content = element.textContent;
                const { text, ranges } = normalizeWithRanges(content || '');
                if (content && content.length >= normalizedText.length - maxErrors) {
                    const matches = search(text, normalizedText, maxErrors);
                    if (matches.length > 0) {
                        matches.sort((a, b) => a.errors - b.errors);
                        const bestMatchInElement = matches[0];
                        if (!result.candidate ||
                            bestMatchInElement.errors < result.candidate.errors ||
                            (bestMatchInElement.errors === result.candidate.errors && content.length <= result.candidate.length)) {
                            const rawStart = ranges[bestMatchInElement.start].start;
                            const rawEnd = ranges[bestMatchInElement.end - 1].end;
                            result.candidate = {
                                element,
                                errors: bestMatchInElement.errors,
                                length: content.length,
                                match: {
                                    start: rawStart,
                                    end: rawEnd,
                                    errors: bestMatchInElement.errors
                                }
                            };
                        }
                    }
                    else if (fuzzy) {
                        const regText = normalizedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, "\\s+");
                        const regex = new RegExp(regText, 'i');
                        const exactMatch = content.match(regex);
                        if (exactMatch && exactMatch.index !== undefined) {
                            result.candidate = {
                                element,
                                errors: 0,
                                length: content.length,
                                match: {
                                    start: exactMatch.index,
                                    end: exactMatch.index + exactMatch[0].length,
                                    errors: 0
                                }
                            };
                        }
                    }
                }
                Array.from(element.children).forEach(child => traverse(child));
            }
        }
        traverse(document.body);
        if (result.candidate) {
            console.log(`[WebView Bridge] Fuzzy match found: ${result.candidate.element.tagName} (Lengths: ${normalizedText.length}, Errors: ${result.candidate.errors}, Error Rate: ${(result.candidate.errors / normalizedText.length * 100).toFixed(2)}%， Available Text Length: ${normalizedText.length - result.candidate.errors}）`);
            return { element: result.candidate.element, match: result.candidate.match };
        }
        return null;
    }
    /**
     * 查找单个匹配元素
     */
    function findMatchingElement(anchorText) {
        const normalizedAnchor = anchorText.trim().replace(/\s+/g, ' ');
        try {
            const fuzzyResult = findBestMatch(normalizedAnchor);
            if (fuzzyResult) {
                const { element, match } = fuzzyResult;
                const range = domAnchorTextPositionExports.toRange(element, { start: match.start, end: match.end });
                if (range) {
                    console.log(`[WebView Bridge] Found approximate text match in: ${element.tagName}`);
                    let container = range.commonAncestorContainer;
                    if (container.nodeType === Node.TEXT_NODE && container.parentNode) {
                        container = container.parentNode;
                    }
                    return { element: container || element, range };
                }
            }
        }
        catch (error) {
            console.warn('[WebView Bridge] Error searching for approximate text:', error);
        }
        console.warn(`[WebView Bridge] No matching element found: ${anchorText}`);
        return null;
    }

    /**
     * 滚动到指定元素
     */
    function scrollToElement(target) {
        const element = target && 'element' in target ? target.element : target;
        const range = target && 'range' in target ? target.range : null;
        if (!element) {
            console.warn('[WebView Bridge] Target element does not exist, cannot scroll');
            return;
        }
        const platform = detectPlatform();
        if (platform === 'android') {
            const rect = range ? range.getBoundingClientRect() : element.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const elementTop = rect.top + scrollTop;
            const documentHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
            postToNativeBridge({
                type: 'scrollToPosition',
                percentage: elementTop / documentHeight
            });
        }
        else if (platform === 'ios') {
            if (range) {
                const rect = range.getBoundingClientRect();
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const elementTop = rect.top + scrollTop;
                const documentHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
                postToNativeBridge({
                    type: 'scrollToPosition',
                    percentage: elementTop / documentHeight
                });
            }
            else {
                element.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'nearest'
                });
            }
        }
    }
    /**
     * 滚动到锚点文本对应的内容
     */
    function scrollToAnchor(anchorText, beforeHighlight) {
        console.log(`[WebView Bridge] Start finding anchor: ${anchorText}`);
        const decodedAnchor = decodeURIComponent(anchorText);
        const match = findMatchingElement(decodedAnchor);
        if (match) {
            beforeHighlight?.();
            highlightElement(match);
            scrollToElement(match);
            return true;
        }
        else {
            console.warn(`[WebView Bridge] No matching element found: ${anchorText}`);
            return false;
        }
    }

    /**
     * 应用必要的 Polyfills 确保兼容性
     */
    function applyPolyfills() {
        if (!window.CSS || !window.CSS.escape) {
            window.CSS = window.CSS || {};
            window.CSS.escape = function (value) {
                if (arguments.length === 0) {
                    throw new TypeError('`CSS.escape` requires an argument.');
                }
                var string = String(value);
                var length = string.length;
                var index = -1;
                var codeUnit;
                var result = '';
                while (++index < length) {
                    codeUnit = string.charCodeAt(index);
                    // 注意：处理代理对等
                    if (codeUnit === 0x0000) {
                        result += '\uFFFD';
                        continue;
                    }
                    if (
                    // 如果字符是 [0-9A-Za-z_-]
                    (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
                        (codeUnit >= 0x0041 && codeUnit <= 0x005A) ||
                        (codeUnit >= 0x0061 && codeUnit <= 0x007A) ||
                        codeUnit === 0x005F ||
                        codeUnit === 0x002D) {
                        result += string.charAt(index);
                        continue;
                    }
                    // 转义其他字符
                    result += '\\' + string.charAt(index);
                }
                return result;
            };
        }
    }

    /**
     * 生成UUID
     */
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }
    /**
     * 移除外层标签，保留内容
     */
    function removeOuterTag(element) {
        const parent = element.parentNode;
        if (!parent)
            return;
        while (element.firstChild) {
            parent.insertBefore(element.firstChild, element);
        }
        parent.removeChild(element);
    }
    /**
     * 获取元素的CSS选择器路径
     */
    function getElementPath(element, container) {
        const path = [];
        let current = element;
        while (current && current !== container) {
            let selector = current.tagName.toLowerCase();
            if (current.id) {
                const id = current.id;
                if (/^\d/.test(id)) {
                    selector += `[id="${id}"]`;
                }
                else if (/[^a-zA-Z0-9_-]/.test(id)) {
                    selector += `[id="${id}"]`;
                }
                else {
                    selector += `#${id}`;
                }
            }
            if (current.className && typeof current.className === 'string') {
                const classes = current.className.trim().split(/\s+/).filter(c => c);
                for (const cls of classes) {
                    if (/[^a-zA-Z0-9_-]/.test(cls) || /^\d/.test(cls)) {
                        selector += `[class~="${cls.replace(/"/g, '\\"')}"]`;
                    }
                    else {
                        selector += `.${cls}`;
                    }
                }
            }
            if (current.parentElement) {
                const siblings = Array.from(current.parentElement.children);
                if (siblings.length > 1) {
                    let hasDuplicate = false;
                    try {
                        hasDuplicate = siblings.some(s => s !== current && s.matches(selector));
                    }
                    catch {
                        hasDuplicate = true;
                    }
                    if (hasDuplicate) {
                        const index = siblings.indexOf(current);
                        selector += `:nth-child(${index + 1})`;
                    }
                }
            }
            path.unshift(selector);
            current = current.parentElement;
        }
        return path.join(' > ');
    }
    /**
     * 获取元素下的所有文本节点
     *
     * ⚠️ 关键：必须与 mark-renderer 中的 getAllTextNodes 保持完全一致
     */
    function getAllTextNodes(element) {
        const unsupportTags = ['UNSUPPORT-VIDEO', 'SCRIPT', 'STYLE', 'NOSCRIPT'];
        const textNodes = [];
        const traverse = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                textNodes.push(node);
            }
            else if (node.nodeType === Node.ELEMENT_NODE &&
                unsupportTags.indexOf(node.tagName) === -1) {
                node.childNodes.forEach((child) => traverse(child));
            }
        };
        traverse(element);
        return textNodes;
    }
    /**
     * 获取Range的文本（包含换行）
     */
    function getRangeTextWithNewlines(range) {
        const selection = window.getSelection();
        if (!selection) {
            const temp = document.createElement('div');
            temp.appendChild(range.cloneContents());
            return temp.innerText;
        }
        const originalRanges = [];
        for (let i = 0; i < selection.rangeCount; i++) {
            originalRanges.push(selection.getRangeAt(i));
        }
        try {
            selection.removeAllRanges();
            selection.addRange(range);
            const text = selection.toString();
            return text;
        }
        finally {
            selection.removeAllRanges();
            for (const originalRange of originalRanges) {
                selection.addRange(originalRange);
            }
        }
    }
    /**
     * 修复无效的 CSS 选择器
     * 处理范围：
     *   1. 以数字开头的 ID / Class
     *   2. 含有特殊字符（: * ! / [ ] 等）的 Class（如 Tailwind CSS 变体类名）
     *   3. 含有转义符（反斜杠）的 Class
     */
    function fixCssSelector(selector) {
        const preserved = [];
        const preserve = (m) => {
            preserved.push(m);
            return `\x01${preserved.length - 1}\x01`;
        };
        // 保护属性选择器 [xxx]
        let safened = selector.replace(/\[[^\]]+\]/g, preserve);
        // 保护伪元素 ::before 等
        safened = safened.replace(/::[a-zA-Z-]+/g, preserve);
        // 保护带参数的伪类 :nth-child(...) 等
        safened = safened.replace(/:(?:nth-child|nth-of-type|nth-last-child|nth-last-of-type)\([^)]+\)/g, preserve);
        // 保护简单伪类 :hover, :focus 等
        safened = safened.replace(/:(?:hover|focus|active|visited|checked|disabled|enabled|first-child|last-child|first-of-type|last-of-type|only-child|only-of-type|empty|not|is|where|has|root|lang|target|focus-within|focus-visible|placeholder-shown|default|read-only|read-write|required|optional|valid|invalid|in-range|out-of-range)(?=[\s,.>+~:[\]()#]|$)/g, preserve);
        // 以数字开头的 ID → [id="xxx"]
        safened = safened.replace(/#(\d[-\w]*)/g, (_, id) => `[id="${id}"]`);
        // 含特殊字符或以数字开头的 Class → [class~="xxx"]
        safened = safened.replace(/\.(?:\\.|[^\s.#>+~[\](),{}\x01])+/g, (match) => {
            const raw = match.slice(1);
            if (/[^a-zA-Z0-9_-]/.test(raw) || /^\d/.test(raw)) {
                const cleaned = raw.replace(/\\(.)/g, '$1');
                return `[class~="${cleaned}"]`;
            }
            return match;
        });
        // 还原暂存的合法选择器片段
        safened = safened.replace(/\x01(\d+)\x01/g, (_, i) => preserved[+i]);
        return safened;
    }
    /**
     * 深度比较两个对象是否相等
     */
    function deepEqual(obj1, obj2) {
        if (obj1 === obj2)
            return true;
        if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 === null || obj2 === null) {
            return false;
        }
        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);
        if (keys1.length !== keys2.length)
            return false;
        for (const key of keys1) {
            if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
                return false;
            }
        }
        return true;
    }

    /**
     * 选择监听器
     *
     * 负责监听用户的文本选择操作
     * 仅通过 selectionchange 事件驱动，避免多监听源导致重复触发
     */
    class SelectionMonitor {
        constructor(container) {
            this.isMonitoring = false;
            this.lastSelectionText = '';
            /** 程序创建且无需通知 Native 的选区 */
            this.suppressedSelectionRange = null;
            /** 用户手指/鼠标是否正在按下 */
            this.isPointerDown = false;
            /** 手指按下期间是否产生了待处理的选区变化 */
            this.hasPendingSelection = false;
            /**
             * 手指/鼠标按下
             */
            this.handlePointerDown = () => {
                this.isPointerDown = true;
                this.hasPendingSelection = false;
                this.suppressedSelectionRange = null;
            };
            /**
             * 手指/鼠标松开，如果有待处理的选区则立即触发回调
             */
            this.handlePointerUp = () => {
                this.isPointerDown = false;
                if (this.hasPendingSelection) {
                    this.hasPendingSelection = false;
                    this.processSelection();
                }
            };
            /**
             * iOS 长按选择文本时，系统接管触摸会触发 touchcancel 而非 touchend。
             * 此时释放 isPointerDown，让后续 selectionchange 防抖正常触发回调。
             */
            this.handleTouchCancel = () => {
                this.isPointerDown = false;
            };
            /**
             * 处理选择变化事件（带防抖）
             *
             * 手指按下期间仅标记"有待处理"，不触发回调；
             * 手指松开后或非触摸场景（如程序设置选区）才真正通知原生端。
             */
            this.handleSelectionChange = () => {
                if (this.selectionChangeTimeout) {
                    clearTimeout(this.selectionChangeTimeout);
                }
                this.selectionChangeTimeout = setTimeout(() => {
                    if (this.isPointerDown) {
                        // 手指仍按下，仅标记待处理，不触发回调
                        this.hasPendingSelection = true;
                        return;
                    }
                    this.processSelection();
                    this.selectionChangeTimeout = undefined;
                }, 300);
            };
            this.container = container;
        }
        /**
         * 开始监听选择
         * @param callback 选区变化时的回调
         * @param onSelectionCleared 选区取消（collapsed 或清空）时的回调
         */
        start(callback, onSelectionCleared) {
            if (this.isMonitoring) {
                return;
            }
            this.onSelectionCallback = callback;
            this.onSelectionClearedCallback = onSelectionCleared;
            document.addEventListener('selectionchange', this.handleSelectionChange);
            document.addEventListener('touchstart', this.handlePointerDown, { passive: true });
            document.addEventListener('mousedown', this.handlePointerDown, { passive: true });
            document.addEventListener('touchend', this.handlePointerUp, { passive: true });
            document.addEventListener('touchcancel', this.handleTouchCancel, { passive: true });
            document.addEventListener('mouseup', this.handlePointerUp, { passive: true });
            this.isMonitoring = true;
        }
        /**
         * 停止监听选择
         */
        stop() {
            if (!this.isMonitoring) {
                return;
            }
            if (this.selectionChangeTimeout) {
                clearTimeout(this.selectionChangeTimeout);
                this.selectionChangeTimeout = undefined;
            }
            document.removeEventListener('selectionchange', this.handleSelectionChange);
            document.removeEventListener('touchstart', this.handlePointerDown);
            document.removeEventListener('mousedown', this.handlePointerDown);
            document.removeEventListener('touchend', this.handlePointerUp);
            document.removeEventListener('touchcancel', this.handleTouchCancel);
            document.removeEventListener('mouseup', this.handlePointerUp);
            this.isMonitoring = false;
            this.lastSelectionText = '';
            this.isPointerDown = false;
            this.hasPendingSelection = false;
            this.suppressedSelectionRange = null;
            this.onSelectionCallback = undefined;
            this.onSelectionClearedCallback = undefined;
        }
        /**
         * 实际处理选区并通知回调
         */
        processSelection() {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) {
                this.suppressedSelectionRange = null;
                this.clearLastSelection();
                return;
            }
            const range = selection.getRangeAt(0);
            if (range.collapsed) {
                this.suppressedSelectionRange = null;
                this.clearLastSelection();
                return;
            }
            if (this.isSuppressedSelection(range)) {
                this.lastSelectionText = '';
                return;
            }
            this.suppressedSelectionRange = null;
            if (!this.container.contains(range.commonAncestorContainer)) {
                return;
            }
            const currentText = selection.toString();
            if (currentText === this.lastSelectionText) {
                return;
            }
            this.lastSelectionText = currentText;
            const selectionInfo = this.parseSelectionFromRange(range);
            if (selectionInfo.selection.length === 0) {
                return;
            }
            if (this.onSelectionCallback) {
                this.onSelectionCallback(selectionInfo);
            }
        }
        /**
         * 清除上次选区记录并通知外部
         */
        clearLastSelection() {
            if (this.lastSelectionText !== '') {
                this.lastSelectionText = '';
                this.onSelectionClearedCallback?.();
            }
        }
        /**
         * 在程序替换当前选区前，结束已上报的用户选区状态。
         */
        prepareForProgrammaticSelection() {
            if (this.selectionChangeTimeout) {
                clearTimeout(this.selectionChangeTimeout);
                this.selectionChangeTimeout = undefined;
            }
            this.hasPendingSelection = false;
            this.suppressedSelectionRange = null;
            this.clearLastSelection();
        }
        /**
         * 记录程序创建的当前选区，使本次 selectionchange 不通知 Native。
         */
        suppressCurrentSelection() {
            const selection = window.getSelection();
            this.suppressedSelectionRange = selection && selection.rangeCount > 0
                ? selection.getRangeAt(0).cloneRange()
                : null;
        }
        isSuppressedSelection(range) {
            const suppressed = this.suppressedSelectionRange;
            return suppressed !== null &&
                range.startContainer === suppressed.startContainer &&
                range.startOffset === suppressed.startOffset &&
                range.endContainer === suppressed.endContainer &&
                range.endOffset === suppressed.endOffset;
        }
        /**
         * 从 range 解析选择（不需要事件对象）
         */
        parseSelectionFromRange(range) {
            const selection = this.getSelectionInfo(range);
            const paths = this.convertSelectionToPaths(selection);
            const approx = this.getApproxInfo(range);
            const position = this.getPositionInfoFromRange(range);
            return { selection, paths, approx, position };
        }
        /**
         * 从 range 获取位置信息
         */
        getPositionInfoFromRange(range) {
            const rangeRect = range.getBoundingClientRect();
            const containerRect = this.container.getBoundingClientRect();
            const clientX = rangeRect.left + rangeRect.width / 2;
            const clientY = rangeRect.bottom;
            return {
                x: clientX - containerRect.left,
                y: clientY - containerRect.top,
                width: rangeRect.width,
                height: rangeRect.height,
                top: rangeRect.top - containerRect.top,
                left: rangeRect.left - containerRect.left,
                right: rangeRect.right - containerRect.left,
                bottom: rangeRect.bottom - containerRect.top
            };
        }
        /**
         * 获取选择信息
         */
        getSelectionInfo(range) {
            if (!range) {
                return [];
            }
            const selectedInfo = [];
            const isNodeFullyInRange = (node) => {
                const nodeRange = document.createRange();
                nodeRange.selectNodeContents(node);
                return (range.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0 &&
                    range.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0);
            };
            const isNodePartiallyInRange = (node) => range.intersectsNode(node);
            const processTextNode = (textNode) => {
                if (!isNodePartiallyInRange(textNode))
                    return;
                let startOffset = textNode === range.startContainer ? range.startOffset : 0;
                let endOffset = textNode === range.endContainer ? range.endOffset : textNode.length;
                startOffset = Math.max(0, Math.min(startOffset, textNode.length));
                endOffset = Math.max(startOffset, Math.min(endOffset, textNode.length));
                if (endOffset > startOffset) {
                    selectedInfo.push({
                        type: 'text',
                        node: textNode,
                        startOffset,
                        endOffset,
                        text: textNode.textContent.slice(startOffset, endOffset)
                    });
                }
            };
            const processNode = (node) => {
                if (node.nodeType === Node.TEXT_NODE && (node.textContent?.trim() || '').length > 0) {
                    processTextNode(node);
                }
                else if (node.nodeType === Node.ELEMENT_NODE) {
                    const element = node;
                    if (element.tagName === 'IMG' && isNodeFullyInRange(element)) {
                        selectedInfo.push({
                            type: 'image',
                            src: element.src,
                            element: element
                        });
                    }
                    if (isNodePartiallyInRange(element)) {
                        for (const child of Array.from(element.childNodes))
                            processNode(child);
                    }
                }
            };
            processNode(range.commonAncestorContainer);
            return selectedInfo.length > 0 &&
                !selectedInfo.every((item) => item.type === 'text' && item.text.trim().length === 0)
                ? selectedInfo
                : [];
        }
        /**
         * 将选择信息转换为路径
         */
        convertSelectionToPaths(selection) {
            const paths = [];
            let currentPath = null;
            let currentStart = 0;
            let currentEnd = 0;
            for (const item of selection) {
                if (item.type === 'text') {
                    let parent = item.node.parentElement;
                    while (parent && parent.tagName === 'SLAX-MARK') {
                        parent = parent.parentElement;
                    }
                    if (!parent)
                        continue;
                    const path = getElementPath(parent, this.container);
                    // 使用与 mark-renderer 相同的逻辑计算文本节点偏移
                    const allTextNodes = getAllTextNodes(parent);
                    let offset = 0;
                    for (const textNode of allTextNodes) {
                        if (textNode === item.node) {
                            break;
                        }
                        offset += (textNode.textContent || '').length;
                    }
                    const start = offset + item.startOffset;
                    const end = offset + item.endOffset;
                    if (path === currentPath) {
                        currentEnd = end;
                    }
                    else {
                        if (currentPath !== null) {
                            paths.push({ type: 'text', path: currentPath, start: currentStart, end: currentEnd });
                        }
                        currentPath = path;
                        currentStart = start;
                        currentEnd = end;
                    }
                }
                else if (item.type === 'image') {
                    if (currentPath !== null) {
                        paths.push({ type: 'text', path: currentPath, start: currentStart, end: currentEnd });
                        currentPath = null;
                    }
                    const path = getElementPath(item.element, this.container);
                    paths.push({ type: 'image', path });
                }
            }
            if (currentPath !== null) {
                paths.push({ type: 'text', path: currentPath, start: currentStart, end: currentEnd });
            }
            return paths;
        }
        /**
         * 获取近似匹配信息
         */
        getApproxInfo(range) {
            const exact = getRangeTextWithNewlines(range);
            const prefixRange = document.createRange();
            prefixRange.setStart(this.container, 0);
            prefixRange.setEnd(range.startContainer, range.startOffset);
            const fullPrefix = getRangeTextWithNewlines(prefixRange);
            const prefix = fullPrefix.slice(-50);
            const suffixRange = document.createRange();
            suffixRange.setStart(range.endContainer, range.endOffset);
            suffixRange.setEndAfter(this.container.lastChild);
            const fullSuffix = getRangeTextWithNewlines(suffixRange);
            const suffix = fullSuffix.slice(0, 50);
            return { exact, prefix, suffix, raw_text: exact };
        }
        /**
         * 清除选择
         */
        clearSelection() {
            this.suppressedSelectionRange = null;
            const selection = window.getSelection();
            if (selection) {
                selection.removeAllRanges();
            }
        }
    }

    /**
     * 标记渲染器
     *
     * 负责在页面上绘制、更新和删除标记（划线和评论）
     */
    class MarkRenderer {
        constructor(container, currentUserId, onMarkTap) {
            this.container = container;
            this.currentUserId = currentUserId;
            this.onMarkTap = onMarkTap;
        }
        /**
         * 根据 MarkPathItem 绘制标记
         */
        drawMark(id, paths, isStroke, hasComment, userId) {
            try {
                const isSelfStroke = userId !== undefined && userId === this.currentUserId && isStroke;
                const baseInfo = {
                    id,
                    isStroke,
                    hasComment,
                    isSelfStroke,
                    isHighlighted: false
                };
                let drawMarkSuccess = false;
                for (const markItem of paths) {
                    if (!isStroke && !hasComment)
                        continue;
                    const infos = this.transferNodeInfos(markItem);
                    for (const infoItem of infos) {
                        if (infoItem.type === 'image') {
                            this.addImageMark({ ...baseInfo, ele: infoItem.ele });
                            continue;
                        }
                        this.addMark({ ...baseInfo, node: infoItem.node, start: infoItem.start, end: infoItem.end });
                    }
                    drawMarkSuccess = infos.length > 0;
                }
                return drawMarkSuccess;
            }
            catch (error) {
                console.error('Failed to draw mark:', error);
                return false;
            }
        }
        /**
         * 将标记路径项转换为节点信息
         */
        transferNodeInfos(markItem) {
            const infos = [];
            const path = fixCssSelector(markItem.path);
            if (markItem.type === 'text') {
                const baseElement = this.container.querySelector(path);
                if (!baseElement) {
                    return infos;
                }
                const nodes = getAllTextNodes(baseElement);
                const nodeLengths = nodes.map((node) => (node.textContent || '').length);
                let startOffset = markItem.start || 0;
                const endOffset = markItem.end || 0;
                let base = 0;
                for (let i = 0; i < nodeLengths.length; i++) {
                    if (base + nodeLengths[i] <= startOffset) {
                        base += nodeLengths[i];
                        continue;
                    }
                    if (endOffset - base <= nodeLengths[i]) {
                        infos.push({ type: 'text', start: startOffset - base, end: endOffset - base, node: nodes[i] });
                        break;
                    }
                    else {
                        infos.push({ type: 'text', start: startOffset - base, end: nodeLengths[i], node: nodes[i] });
                        startOffset += nodeLengths[i] - (startOffset - base);
                        base += nodeLengths[i];
                    }
                }
            }
            else if (markItem.type === 'image') {
                let element = this.container.querySelector(path);
                if (!element || !element.src) {
                    // 尝试在slax-mark标签内查找
                    const paths = path.split('>');
                    const tailIdx = paths.length - 1;
                    const newPath = [...paths.slice(0, tailIdx), ' slax-mark ', paths[tailIdx]];
                    element = this.container.querySelector(newPath.join('>'));
                }
                if (element) {
                    infos.push({ type: 'image', ele: element });
                }
            }
            return infos;
        }
        /**
         * 在文本节点上添加标记
         */
        addMark(info) {
            const { id, node, start, end, isStroke, hasComment, isSelfStroke, isHighlighted } = info;
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, end);
            const mark = document.createElement('slax-mark');
            mark.dataset.uuid = id;
            if (isStroke)
                mark.classList.add('stroke');
            if (hasComment)
                mark.classList.add('comment');
            if (isSelfStroke)
                mark.classList.add('self-stroke');
            if (isHighlighted)
                mark.classList.add('highlighted');
            // 直接在元素上绑定 touchend，避免容器级别委托时 event.target 不可靠的问题
            if (this.onMarkTap) {
                const tapCallback = this.onMarkTap;
                mark.addEventListener('touchend', (e) => tapCallback(id, e));
            }
            try {
                range.surroundContents(mark);
            }
            catch (error) {
                console.error('Failed to surround contents:', error);
            }
        }
        /**
         * 添加图片标记
         */
        addImageMark(info) {
            const { id, ele, isStroke, hasComment, isSelfStroke, isHighlighted } = info;
            const mark = document.createElement('slax-mark');
            mark.dataset.uuid = id;
            if (isStroke)
                mark.classList.add('stroke');
            if (hasComment)
                mark.classList.add('comment');
            if (isSelfStroke)
                mark.classList.add('self-stroke');
            if (isHighlighted)
                mark.classList.add('highlighted');
            // 直接在元素上绑定 touchend
            if (this.onMarkTap) {
                const tapCallback = this.onMarkTap;
                mark.addEventListener('touchend', (e) => tapCallback(id, e));
            }
            ele.parentElement?.insertBefore(mark, ele);
            ele.remove();
            mark.appendChild(ele);
        }
        /**
         * 更新标记
         */
        updateMark(id, isStroke, hasComment, userId) {
            const marks = Array.from(this.container.querySelectorAll(`slax-mark[data-uuid="${id}"]`));
            const isSelfStroke = userId !== undefined && userId === this.currentUserId;
            marks.forEach((mark) => {
                if (isStroke) {
                    mark.classList.add('stroke');
                }
                else {
                    mark.classList.remove('stroke');
                }
                if (hasComment) {
                    mark.classList.add('comment');
                }
                else {
                    mark.classList.remove('comment');
                }
                if (isSelfStroke) {
                    mark.classList.add('self-stroke');
                }
                else {
                    mark.classList.remove('self-stroke');
                }
                // 如果既没有划线也没有评论，删除标记
                if (!isStroke && !hasComment) {
                    removeOuterTag(mark);
                }
            });
        }
        /**
         * 删除标记
         */
        removeMark(id) {
            const marks = Array.from(this.container.querySelectorAll(`slax-mark[data-uuid="${id}"]`));
            marks.forEach((mark) => removeOuterTag(mark));
        }
        /**
         * 高亮标记
         */
        highlightMark(id) {
            this.clearAllHighlights();
            const marks = Array.from(this.container.querySelectorAll(`slax-mark[data-uuid="${id}"]`));
            marks.forEach((mark) => mark.classList.add('highlighted'));
            if (marks.length > 0) {
                marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        /**
         * 清除所有高亮
         */
        clearAllHighlights() {
            const marks = Array.from(this.container.querySelectorAll('slax-mark.highlighted'));
            marks.forEach((mark) => mark.classList.remove('highlighted'));
        }
        /**
         * 清除所有标记
         */
        clearAllMarks() {
            const marks = Array.from(this.container.querySelectorAll('slax-mark'));
            marks.forEach((mark) => removeOuterTag(mark));
        }
        /**
         * 获取所有标记ID
         */
        getAllMarkIds() {
            const marks = Array.from(this.container.querySelectorAll('slax-mark[data-uuid]'));
            const ids = new Set();
            marks.forEach((mark) => {
                const id = mark.dataset.uuid;
                if (id)
                    ids.add(id);
            });
            return Array.from(ids);
        }
    }

    /**
     * 标记管理器
     *
     * 负责处理后端 MarkDetail 数据的预处理、分组和渲染
     */
    class MarkManager {
        constructor(container, currentUserId, onMarkTap, onMarkItemInfosChange) {
            this.markItemInfos = [];
            /** 抑制变化通知（用于内部连续操作避免重复通知） */
            this._suppressChangeNotification = false;
            this.container = container;
            this.renderer = new MarkRenderer(container, currentUserId, onMarkTap);
            this.onMarkItemInfosChange = onMarkItemInfosChange;
        }
        /**
         * 根据选区 paths 解析对应的 MarkItemInfo
         *
         * 如果与已有的 MarkItemInfo 的 source 完全匹配，则返回该 MarkItemInfo；
         * 否则创建一个临时的 MarkItemInfo。
         */
        resolveMarkItemInfo(paths, approx) {
            if (paths.length === 0) {
                return null;
            }
            const existing = this.markItemInfos.find((info) => this.checkMarkSourceIsSame(info.source, paths));
            if (existing) {
                if (!existing.approx && approx) {
                    existing.approx = approx;
                }
                return existing;
            }
            const created = {
                id: '',
                source: paths,
                comments: [],
                stroke: [],
                approx
            };
            return created;
        }
        /**
         * 通知外部 markItemInfos 数据已变化
         */
        notifyMarkItemInfosChanged() {
            if (this._suppressChangeNotification)
                return;
            this.onMarkItemInfosChange?.([...this.markItemInfos]);
        }
        /**
         * 绘制多个标记
         *
         * @param marks 后端返回的 MarkDetail 数据
         * @returns 键值对：uuid -> 该uuid对应的后端mark列表
         */
        drawMarks(marks) {
            // 保留旧的 markItemInfos，用于在重新生成时复用已有的 id
            const previousMarkItemInfos = this.markItemInfos;
            this._suppressChangeNotification = true;
            this.clearAllMarks();
            this._suppressChangeNotification = false;
            const userMap = this.createUserMap(marks.user_list);
            const commentMap = this.buildCommentMap(marks.mark_list, userMap);
            this.buildCommentRelationships(marks.mark_list, commentMap);
            console.log('[MarkManager] drawMarks 变动前 markItemInfos（共 %d 条）:', previousMarkItemInfos.length, JSON.parse(JSON.stringify(previousMarkItemInfos)));
            this.markItemInfos = this.generateMarkItemInfos(marks.mark_list, commentMap, previousMarkItemInfos);
            console.log('[MarkManager] drawMarks 变动后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)));
            for (const info of this.markItemInfos) {
                this.drawSingleMarkItem(info);
            }
            this.notifyMarkItemInfosChanged();
            return this.buildDrawMarksResult(marks.mark_list);
        }
        /**
         * 根据 UUID 删除标记
         */
        removeMarkByUuid(uuid) {
            console.log('[MarkManager] removeMarkByUuid 变动前 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)));
            this.renderer.removeMark(uuid);
            this.markItemInfos = this.markItemInfos.filter((info) => info.id !== uuid);
            console.log('[MarkManager] removeMarkByUuid 变动后 markItemInfos（共 %d 条），已移除 uuid:', this.markItemInfos.length, uuid, JSON.parse(JSON.stringify(this.markItemInfos)));
            this.notifyMarkItemInfosChanged();
        }
        /**
         * 根据本地 UUID 获取 MarkItemInfo
         */
        getMarkItemInfoByUuid(uuid) {
            return this.markItemInfos.find((info) => info.id === uuid) ?? null;
        }
        /**
         * 清除所有标记
         */
        clearAllMarks() {
            console.log('[MarkManager] clearAllMarks 变动前 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)));
            this.renderer.clearAllMarks();
            this.markItemInfos = [];
            console.log('[MarkManager] clearAllMarks 变动后 markItemInfos 已清空（共 0 条）');
            this.notifyMarkItemInfosChanged();
        }
        /**
         * 根据 UUID 为指定用户添加划线
         *
         * 在对应 MarkItemInfo 的 stroke 数组中追加一条记录，并重新渲染该标记的 DOM 样式。
         * 如果该用户已有划线，则跳过（幂等）。
         *
         * @param uuid MarkItemInfo 的本地 UUID
         * @param userId 执行划线的用户ID
         * @returns 是否成功添加（false 表示 uuid 不存在或用户已有划线）
         */
        addStrokeByUuid(uuid, userId) {
            console.log('[MarkManager] addStrokeByUuid 入参 → uuid:', uuid, 'userId:', userId);
            console.log('[MarkManager] addStrokeByUuid 当前 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)));
            const infoItem = this.markItemInfos.find((info) => info.id === uuid);
            if (!infoItem) {
                console.warn('[MarkManager] addStrokeByUuid 未找到对应的 MarkItemInfo，uuid:', uuid);
                console.log('[MarkManager] addStrokeByUuid 出参 → false（uuid 不存在）');
                return false;
            }
            console.log('[MarkManager] addStrokeByUuid 找到 MarkItemInfo:', JSON.parse(JSON.stringify(infoItem)));
            console.log('[MarkManager] addStrokeByUuid 当前 stroke 列表:', JSON.parse(JSON.stringify(infoItem.stroke)));
            const alreadyStroked = infoItem.stroke.some((s) => s.userId === userId);
            if (alreadyStroked) {
                console.log('[MarkManager] addStrokeByUuid 用户已有划线，跳过，uuid:', uuid, 'userId:', userId);
                console.log('[MarkManager] addStrokeByUuid 出参 → false（用户已有划线）');
                return false;
            }
            console.log('[MarkManager] addStrokeByUuid 变动前 stroke:', JSON.parse(JSON.stringify(infoItem.stroke)));
            infoItem.stroke.push({ mark_id: undefined, userId });
            console.log('[MarkManager] addStrokeByUuid 变动后 stroke:', JSON.parse(JSON.stringify(infoItem.stroke)));
            this.updateMarkItemUI(infoItem);
            this.notifyMarkItemInfosChanged();
            console.log('[MarkManager] addStrokeByUuid 操作完成后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)));
            console.log('[MarkManager] addStrokeByUuid 出参 → true');
            return true;
        }
        /**
         * 根据 UUID 删除指定用户的划线
         *
         * 从对应 MarkItemInfo 的 stroke 数组中移除该用户的记录，并重新渲染 DOM 样式。
         * 如果移除后 stroke 和 comments 均为空，则整体删除该标记。
         *
         * @param uuid MarkItemInfo 的本地 UUID
         * @param userId 要删除划线的用户ID
         * @returns 是否成功删除（false 表示 uuid 不存在或该用户无划线）
         */
        removeStrokeByUuid(uuid, userId) {
            console.log('[MarkManager] removeStrokeByUuid 入参 → uuid:', uuid, 'userId:', userId);
            console.log('[MarkManager] removeStrokeByUuid 当前 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)));
            const infoItem = this.markItemInfos.find((info) => info.id === uuid);
            if (!infoItem) {
                console.warn('[MarkManager] removeStrokeByUuid 未找到对应的 MarkItemInfo，uuid:', uuid);
                console.log('[MarkManager] removeStrokeByUuid 出参 → false（uuid 不存在）');
                return false;
            }
            console.log('[MarkManager] removeStrokeByUuid 找到 MarkItemInfo:', JSON.parse(JSON.stringify(infoItem)));
            console.log('[MarkManager] removeStrokeByUuid 当前 stroke 列表:', JSON.parse(JSON.stringify(infoItem.stroke)));
            const strokeIndex = infoItem.stroke.findIndex((s) => s.userId === userId);
            if (strokeIndex === -1) {
                console.log('[MarkManager] removeStrokeByUuid 该用户无划线，跳过，uuid:', uuid, 'userId:', userId);
                console.log('[MarkManager] removeStrokeByUuid 出参 → false（用户无划线）');
                return false;
            }
            console.log('[MarkManager] removeStrokeByUuid 变动前 stroke:', JSON.parse(JSON.stringify(infoItem.stroke)));
            console.log('[MarkManager] removeStrokeByUuid 即将移除 stroke[%d]:', strokeIndex, JSON.parse(JSON.stringify(infoItem.stroke[strokeIndex])));
            infoItem.stroke.splice(strokeIndex, 1);
            console.log('[MarkManager] removeStrokeByUuid 变动后 stroke:', JSON.parse(JSON.stringify(infoItem.stroke)));
            if (infoItem.stroke.length === 0 && infoItem.comments.length === 0) {
                console.log('[MarkManager] removeStrokeByUuid 标记已无划线和评论，整体删除，uuid:', uuid);
                console.log('[MarkManager] removeStrokeByUuid 删除前 markItemInfos（共 %d 条）:', this.markItemInfos.length);
                this._suppressChangeNotification = true;
                this.removeMarkByUuid(uuid);
                this._suppressChangeNotification = false;
                console.log('[MarkManager] removeStrokeByUuid 删除后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)));
            }
            else {
                this.updateMarkItemUI(infoItem);
                console.log('[MarkManager] removeStrokeByUuid 更新UI完成，剩余 stroke: %d, comments: %d', infoItem.stroke.length, infoItem.comments.length);
            }
            console.log('[MarkManager] removeStrokeByUuid 操作完成后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)));
            console.log('[MarkManager] removeStrokeByUuid 出参 → true');
            this.notifyMarkItemInfosChanged();
            return true;
        }
        /**
         * 根据 UUID 添加评论
         *
         * 在对应 MarkItemInfo 的 comments 数组中追加一条评论记录，并重新渲染 DOM 样式。
         *
         * @param uuid MarkItemInfo 的本地 UUID
         * @param userId 发表评论的用户ID
         * @param comment 评论内容
         * @returns 是否成功添加（false 表示 uuid 不存在）
         */
        addCommentByUuid(uuid, userId, comment) {
            console.log('[MarkManager] addCommentByUuid 入参 → uuid:', uuid, 'userId:', userId, 'comment:', comment);
            console.log('[MarkManager] addCommentByUuid 当前 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)));
            const infoItem = this.markItemInfos.find((info) => info.id === uuid);
            if (!infoItem) {
                console.warn('[MarkManager] addCommentByUuid 未找到对应的 MarkItemInfo，uuid:', uuid);
                return false;
            }
            console.log('[MarkManager] addCommentByUuid 找到 MarkItemInfo:', JSON.parse(JSON.stringify(infoItem)));
            console.log('[MarkManager] addCommentByUuid 变动前 comments（共 %d 条）:', infoItem.comments.length, JSON.parse(JSON.stringify(infoItem.comments)));
            const commentInfo = {
                markId: 0,
                comment,
                userId,
                username: '',
                avatar: '',
                isDeleted: false,
                children: [],
                createdAt: new Date(),
                showInput: false,
                loading: false,
                operateLoading: false
            };
            infoItem.comments.push(commentInfo);
            console.log('[MarkManager] addCommentByUuid 变动后 comments（共 %d 条）:', infoItem.comments.length, JSON.parse(JSON.stringify(infoItem.comments)));
            this.updateMarkItemUI(infoItem);
            this.notifyMarkItemInfosChanged();
            console.log('[MarkManager] addCommentByUuid 操作完成后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)));
            return true;
        }
        /**
         * 更新单个 MarkItemInfo 对应的 DOM 样式
         *
         * 根据当前 stroke 和 comments 的状态，通过 renderer.updateMark 刷新 slax-mark 的 CSS class。
         */
        updateMarkItemUI(info) {
            const hasStroke = info.stroke.length > 0;
            const hasComment = info.comments.length > 0;
            const userId = info.stroke.length > 0 ? info.stroke[0].userId : info.comments[0]?.userId;
            this.renderer.updateMark(info.id, hasStroke, hasComment, userId);
        }
        /**
         * 高亮指定UUID的标记
         */
        highlightMark(uuid) {
            this.renderer.highlightMark(uuid);
        }
        /**
         * 清除所有高亮
         */
        clearAllHighlights() {
            this.renderer.clearAllHighlights();
        }
        /**
         * 获取所有标记ID
         */
        getAllMarkIds() {
            return this.renderer.getAllMarkIds();
        }
        /**
         * 步骤1：创建用户映射
         */
        createUserMap(userList) {
            return new Map(Object.entries(userList).map(([key, value]) => [Number(key), value]));
        }
        /**
         * 步骤2：构建评论映射
         */
        buildCommentMap(markList, userMap) {
            const commentMap = new Map();
            const COMMENT_TYPES = [2, 3, 5]; // COMMENT, REPLY, ORIGIN_COMMENT
            for (const mark of markList) {
                if (COMMENT_TYPES.includes(mark.type)) {
                    const user = userMap.get(mark.user_id);
                    const comment = {
                        markId: mark.id,
                        comment: mark.comment,
                        userId: mark.user_id,
                        username: user?.username || '',
                        avatar: user?.avatar || '',
                        isDeleted: mark.is_deleted,
                        children: [],
                        createdAt: typeof mark.created_at === 'string' ? new Date(mark.created_at) : mark.created_at,
                        rootId: mark.root_id,
                        showInput: false,
                        loading: false,
                        operateLoading: false
                    };
                    commentMap.set(mark.id, comment);
                }
            }
            return commentMap;
        }
        /**
         * 步骤3：构建评论关系（回复的父子关系）
         */
        buildCommentRelationships(markList, commentMap) {
            const REPLY_TYPE = 3;
            for (const mark of markList) {
                if (mark.type !== REPLY_TYPE)
                    continue;
                if (!commentMap.has(mark.id) ||
                    !commentMap.has(mark.parent_id) ||
                    !commentMap.has(mark.root_id))
                    continue;
                const comment = commentMap.get(mark.id);
                const parentComment = commentMap.get(mark.parent_id);
                comment.reply = {
                    id: parentComment.markId,
                    username: parentComment.username,
                    userId: parentComment.userId,
                    avatar: parentComment.avatar
                };
                const rootComment = commentMap.get(mark.root_id);
                if (rootComment) {
                    rootComment.children.push(comment);
                }
            }
        }
        /**
         * 步骤4：生成 MarkItemInfo 列表（按source分组）
         */
        generateMarkItemInfos(markList, commentMap, previousMarkItemInfos = []) {
            const infoItems = [];
            const LINE_TYPES = [1, 4]; // LINE, ORIGIN_LINE
            const COMMENT_TYPES = [2, 5]; // COMMENT, ORIGIN_COMMENT
            const ORIGIN_TYPES = [4, 5]; // ORIGIN_LINE, ORIGIN_COMMENT
            const REPLY_TYPE = 3;
            for (const mark of markList) {
                const source = mark.source;
                // 跳过 REPLY 类型和数字类型的 source
                if (typeof source === 'number' || mark.type === REPLY_TYPE)
                    continue;
                // 跳过没有 approx_source 的原始标记
                if (ORIGIN_TYPES.includes(mark.type) &&
                    (!mark.approx_source || Object.keys(mark.approx_source).length === 0)) {
                    continue;
                }
                const markSources = source;
                let markInfoItem = infoItems.find((infoItem) => this.checkMarkSourceIsSame(infoItem.source, markSources));
                if (markInfoItem && !markInfoItem.approx && mark.approx_source) {
                    try {
                        const newRange = this.getRangeFromApprox(mark.approx_source);
                        const rawText = newRange ? getRangeTextWithNewlines(newRange) : undefined;
                        mark.approx_source.raw_text = rawText;
                    }
                    catch (error) {
                        console.error('create raw text failed', error, mark.approx_source?.exact);
                    }
                    markInfoItem.approx = mark.approx_source;
                }
                if (!markInfoItem) {
                    if (mark.approx_source) {
                        try {
                            const newRange = this.getRangeFromApprox(mark.approx_source);
                            const rawText = newRange ? getRangeTextWithNewlines(newRange) : undefined;
                            mark.approx_source.raw_text = rawText;
                        }
                        catch (error) {
                            console.error('create raw text failed', error, mark.approx_source?.exact);
                        }
                    }
                    // 从旧的 markItemInfos 中查找相同 source 的项，复用其 id，
                    // 避免重新渲染后 id 变化导致外部持有的引用失效
                    const previousItem = previousMarkItemInfos.find((prev) => this.checkMarkSourceIsSame(prev.source, markSources));
                    markInfoItem = {
                        id: previousItem?.id ?? generateUUID(),
                        source: markSources,
                        comments: [],
                        stroke: [],
                        approx: mark.approx_source
                    };
                    infoItems.push(markInfoItem);
                }
                if (LINE_TYPES.includes(mark.type)) {
                    if (!mark.comment && mark.is_deleted)
                        continue;
                    markInfoItem.stroke.push({ mark_id: mark.id, userId: mark.user_id });
                }
                else if (COMMENT_TYPES.includes(mark.type)) {
                    const comment = commentMap.get(mark.id);
                    if (!comment || (comment.isDeleted && comment.children.length === 0)) {
                        continue;
                    }
                    markInfoItem.comments.push(comment);
                }
            }
            return infoItems;
        }
        /**
         * 对当前选中区域执行划线处理
         *
         * 读取 window.getSelection() → 解析路径和 approx → 构建 MarkItemInfo → 渲染划线
         *
         * 注意：此方法不调用后端 API，只在本地渲染。
         * 返回值包含调用 /v1/mark/create 接口所需的全部字段，以及用于后续关联的 uuid。
         * 拿到后端 mark_id 后，调用 updateMarkIdByUuid 完成关联。
         *
         * @param userId 当前用户ID（可选）
         * @returns StrokeCreateData（含 uuid 及接口入参），若选区无效则返回 null
         */
        strokeCurrentSelection(userId) {
            console.log('[MarkManager] strokeCurrentSelection 开始，userId:', userId);
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) {
                console.log('[MarkManager] strokeCurrentSelection 终止：无选区');
                return null;
            }
            const range = selection.getRangeAt(0);
            if (range.collapsed) {
                console.log('[MarkManager] strokeCurrentSelection 终止：选区已折叠');
                return null;
            }
            if (!this.container.contains(range.commonAncestorContainer)) {
                console.log('[MarkManager] strokeCurrentSelection 终止：选区不在容器内');
                return null;
            }
            // 一次性解析选区内的节点信息，后续各步骤共用
            const selectionInfo = this.getSelectionInfoFromRange(range);
            console.log('[MarkManager] strokeCurrentSelection selectionInfo 解析结果，数量:', selectionInfo.length, selectionInfo);
            if (selectionInfo.length === 0) {
                console.log('[MarkManager] strokeCurrentSelection 终止：selectionInfo 为空');
                return null;
            }
            // 解析渲染所需的路径（MarkPathItem[]）
            const paths = this.buildPathsFromSelectionInfo(selectionInfo);
            console.log('[MarkManager] strokeCurrentSelection paths 解析结果，数量:', paths.length, paths);
            if (paths.length === 0) {
                console.log('[MarkManager] strokeCurrentSelection 终止：paths 为空');
                return null;
            }
            // 解析 approx（同时得到接口格式的 approx_source，含 position_start/position_end）
            const { approx, approxCreate } = this.parseApproxFromRange(range);
            console.log('[MarkManager] strokeCurrentSelection approx:', approx, 'approxCreate:', approxCreate);
            // 构建接口所需的 select_content
            const selectContent = this.buildSelectContent(selectionInfo);
            console.log('[MarkManager] strokeCurrentSelection selectContent:', selectContent);
            // 接口所需的 source（xpath 格式）
            const apiSource = this.convertToApiSource(paths);
            console.log('[MarkManager] strokeCurrentSelection apiSource:', apiSource);
            // 检查是否已存在相同 source 的 MarkItemInfo（幂等处理）
            const existing = this.markItemInfos.find((info) => this.checkMarkSourceIsSame(info.source, paths));
            if (existing) {
                console.log('[MarkManager] strokeCurrentSelection 命中已有 MarkItemInfo，uuid:', existing.id);
                const alreadyStroked = existing.stroke.some((s) => s.userId === (userId ?? 0));
                if (!alreadyStroked) {
                    console.log('[MarkManager] strokeCurrentSelection 当前用户尚未划线，追加 stroke');
                    console.log('[MarkManager] strokeCurrentSelection 变动前 existing.stroke:', JSON.parse(JSON.stringify(existing.stroke)));
                    existing.stroke.push({ mark_id: undefined, userId: userId ?? 0 });
                    console.log('[MarkManager] strokeCurrentSelection 变动后 existing.stroke:', JSON.parse(JSON.stringify(existing.stroke)));
                    console.log('[MarkManager] strokeCurrentSelection 变动后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)));
                    this.drawSingleMarkItem(existing);
                    this.notifyMarkItemInfosChanged();
                }
                else {
                    console.log('[MarkManager] strokeCurrentSelection 当前用户已有划线，跳过渲染');
                }
                return {
                    uuid: existing.id,
                    source: apiSource,
                    select_content: selectContent,
                    approx_source: approxCreate
                };
            }
            // 构建新的 MarkItemInfo 并渲染
            const uuid = generateUUID();
            console.log('[MarkManager] strokeCurrentSelection 创建新 MarkItemInfo，uuid:', uuid);
            const infoItem = {
                id: uuid,
                source: paths,
                stroke: [{ mark_id: undefined, userId: userId ?? 0 }],
                comments: [],
                approx
            };
            console.log('[MarkManager] strokeCurrentSelection 变动前 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)));
            this.markItemInfos.push(infoItem);
            console.log('[MarkManager] strokeCurrentSelection 变动后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)));
            this.drawSingleMarkItem(infoItem);
            this.notifyMarkItemInfosChanged();
            const result = {
                uuid,
                source: apiSource,
                select_content: selectContent,
                approx_source: approxCreate
            };
            console.log('[MarkManager] strokeCurrentSelection 完成，返回:', result);
            return result;
        }
        /**
         * 获取当前选区数据
         *
         * 与 strokeCurrentSelection 类似，但不执行渲染和幂等处理，
         * 仅读取当前选区并返回接口所需的数据结构。
         *
         * @returns StrokeCreateData（不含 uuid），若选区无效则返回 null
         */
        captureCurrentSelection() {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0)
                return null;
            const range = selection.getRangeAt(0);
            if (range.collapsed)
                return null;
            if (!this.container.contains(range.commonAncestorContainer))
                return null;
            const selectionInfo = this.getSelectionInfoFromRange(range);
            if (selectionInfo.length === 0)
                return null;
            const paths = this.buildPathsFromSelectionInfo(selectionInfo);
            if (paths.length === 0)
                return null;
            const { approxCreate } = this.parseApproxFromRange(range);
            const selectContent = this.buildSelectContent(selectionInfo);
            const apiSource = this.convertToApiSource(paths);
            return {
                source: apiSource,
                select_content: selectContent,
                approx_source: approxCreate,
                text: selectContent.map((item) => item.text).join('')
            };
        }
        /**
         * 通过 uuid 找到对应的 MarkItemInfo，并将其 stroke 中 mark_id 为空的项更新为指定 mark_id
         *
         * 用于在后端 API 返回 mark_id 后，将本地临时记录与后端数据关联
         *
         * @param uuid MarkItemInfo 的 uuid（由 strokeCurrentSelection 返回）
         * @param markId 后端返回的 mark_id
         * @param userId 用户ID（用于精确匹配对应 stroke 条目，可选）
         */
        updateMarkIdByUuid(uuid, markId, userId) {
            console.log('[MarkManager] updateMarkIdByUuid 入参 → uuid:', uuid, 'markId:', markId, 'userId:', userId);
            console.log('[MarkManager] updateMarkIdByUuid 当前 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)));
            const infoItem = this.markItemInfos.find((info) => info.id === uuid);
            if (!infoItem) {
                console.warn('[MarkManager] updateMarkIdByUuid 未找到对应的 MarkItemInfo，uuid:', uuid);
                console.log('[MarkManager] updateMarkIdByUuid 出参 → void（uuid 不存在，未做任何变更）');
                return;
            }
            console.log('[MarkManager] updateMarkIdByUuid 找到 MarkItemInfo:', JSON.parse(JSON.stringify(infoItem)));
            console.log('[MarkManager] updateMarkIdByUuid 变动前 stroke 列表:', JSON.parse(JSON.stringify(infoItem.stroke)));
            const stroke = infoItem.stroke.find((s) => !s.mark_id && (userId === undefined || s.userId === userId));
            if (stroke) {
                console.log('[MarkManager] updateMarkIdByUuid 找到匹配 stroke，更新前:', JSON.parse(JSON.stringify(stroke)));
                stroke.mark_id = markId;
                console.log('[MarkManager] updateMarkIdByUuid 更新后 stroke:', JSON.parse(JSON.stringify(stroke)));
                this.notifyMarkItemInfosChanged();
            }
            else {
                console.warn('[MarkManager] updateMarkIdByUuid 未找到可更新的 stroke（mark_id 为空且 userId 匹配）', 'userId 过滤条件:', userId);
            }
            console.log('[MarkManager] updateMarkIdByUuid 变动后 stroke 列表:', JSON.parse(JSON.stringify(infoItem.stroke)));
            console.log('[MarkManager] updateMarkIdByUuid 操作完成后 markItemInfos（共 %d 条）:', this.markItemInfos.length, JSON.parse(JSON.stringify(this.markItemInfos)));
            console.log('[MarkManager] updateMarkIdByUuid 出参 → void（完成）');
        }
        /**
         * 从已解析的选区节点信息构建 MarkPathItem 数组（供渲染使用）
         *
         * 相邻同 path 的文本项合并为一个条目；SLAX-MARK 标签会被穿透，
         * 使用其真实父元素的路径，与 SelectionMonitor.convertSelectionToPaths 逻辑一致
         */
        buildPathsFromSelectionInfo(selectionInfo) {
            const paths = [];
            let currentPath = null;
            let currentStart = 0;
            let currentEnd = 0;
            for (const item of selectionInfo) {
                if (item.type === 'text') {
                    let parent = item.node.parentElement;
                    while (parent && parent.tagName === 'SLAX-MARK') {
                        parent = parent.parentElement;
                    }
                    if (!parent)
                        continue;
                    const path = getElementPath(parent, this.container);
                    const allTextNodes = getAllTextNodes(parent);
                    let offset = 0;
                    for (const textNode of allTextNodes) {
                        if (textNode === item.node)
                            break;
                        offset += (textNode.textContent || '').length;
                    }
                    const start = offset + item.startOffset;
                    const end = offset + item.endOffset;
                    if (path === currentPath) {
                        currentEnd = end;
                    }
                    else {
                        if (currentPath !== null) {
                            paths.push({ type: 'text', path: currentPath, start: currentStart, end: currentEnd });
                        }
                        currentPath = path;
                        currentStart = start;
                        currentEnd = end;
                    }
                }
                else if (item.type === 'image') {
                    if (currentPath !== null) {
                        paths.push({ type: 'text', path: currentPath, start: currentStart, end: currentEnd });
                        currentPath = null;
                    }
                    const path = getElementPath(item.element, this.container);
                    paths.push({ type: 'image', path });
                }
            }
            if (currentPath !== null) {
                paths.push({ type: 'text', path: currentPath, start: currentStart, end: currentEnd });
            }
            return paths;
        }
        /**
         * 将渲染用的 MarkPathItem[] 转换为接口入参格式 StrokeCreateSource[]
         *
         * 字段映射：path → xpath，start → start_offset，end → end_offset
         * 图片类型的偏移量固定为 0
         */
        convertToApiSource(paths) {
            return paths.map((p) => ({
                type: p.type,
                xpath: p.path,
                start_offset: p.start ?? 0,
                end_offset: p.end ?? 0
            }));
        }
        /**
         * 从已解析的选区节点信息构建 select_content
         *
         * 构建逻辑参考 DwebArticleSelection.handleMouseUp 对 list 的遍历：
         * - 相邻文本项合并（去除换行）
         * - 图片独立一项
         */
        buildSelectContent(selectionInfo) {
            const result = [];
            for (const item of selectionInfo) {
                if (item.type === 'text') {
                    const rawText = (item.node.textContent || '').slice(item.startOffset, item.endOffset);
                    const text = rawText.replace(/\n/g, '');
                    const last = result[result.length - 1];
                    if (last?.type === 'text') {
                        // 与 DwebArticleSelection 一致：相邻文本合并
                        last.text += text;
                    }
                    else {
                        result.push({ type: 'text', text, src: '' });
                    }
                }
                else if (item.type === 'image') {
                    result.push({ type: 'image', text: ' 🖼️ ', src: item.element.src });
                }
            }
            return result;
        }
        /**
         * 从 Range 获取选区信息（文本节点 + 图片列表）
         */
        getSelectionInfoFromRange(range) {
            const result = [];
            const isFullyInRange = (node) => {
                const nr = document.createRange();
                nr.selectNodeContents(node);
                return (range.compareBoundaryPoints(Range.START_TO_START, nr) <= 0 &&
                    range.compareBoundaryPoints(Range.END_TO_END, nr) >= 0);
            };
            const partiallyInRange = (node) => range.intersectsNode(node);
            const processNode = (node) => {
                if (node.nodeType === Node.TEXT_NODE && (node.textContent?.trim() || '').length > 0) {
                    if (!partiallyInRange(node))
                        return;
                    let startOffset = node === range.startContainer ? range.startOffset : 0;
                    let endOffset = node === range.endContainer ? range.endOffset : node.length;
                    startOffset = Math.max(0, Math.min(startOffset, node.length));
                    endOffset = Math.max(startOffset, Math.min(endOffset, node.length));
                    if (endOffset > startOffset) {
                        result.push({ type: 'text', node, startOffset, endOffset });
                    }
                }
                else if (node.nodeType === Node.ELEMENT_NODE) {
                    const el = node;
                    if (el.tagName === 'IMG' && isFullyInRange(el)) {
                        result.push({ type: 'image', element: el });
                    }
                    if (partiallyInRange(el)) {
                        for (const child of Array.from(el.childNodes))
                            processNode(child);
                    }
                }
            };
            processNode(range.commonAncestorContainer);
            return result;
        }
        /**
         * 从 Range 中提取 approx 信息，同时返回渲染格式和接口格式
         *
         * - approx：供 MarkItemInfo 内部使用（含 raw_text）
         * - approxCreate：供 /v1/mark/create 接口使用（含 position_start / position_end）
         *
         * position_start = 容器起点到选区起点的完整文本长度
         * position_end   = position_start + exact.length
         */
        parseApproxFromRange(range) {
            const exact = getRangeTextWithNewlines(range);
            const prefixRange = document.createRange();
            prefixRange.setStart(this.container, 0);
            prefixRange.setEnd(range.startContainer, range.startOffset);
            const fullPrefix = getRangeTextWithNewlines(prefixRange);
            const prefix = fullPrefix.slice(-50);
            const suffixRange = document.createRange();
            suffixRange.setStart(range.endContainer, range.endOffset);
            if (this.container.lastChild) {
                suffixRange.setEndAfter(this.container.lastChild);
            }
            const fullSuffix = getRangeTextWithNewlines(suffixRange);
            const suffix = fullSuffix.slice(0, 50);
            const position_start = fullPrefix.length;
            const position_end = position_start + exact.length;
            return {
                approx: { exact, prefix, suffix, raw_text: exact },
                approxCreate: { exact, prefix, suffix, position_start, position_end }
            };
        }
        /**
         * 检查两个 source 是否相同
         */
        checkMarkSourceIsSame(source1, source2) {
            return deepEqual(source1, source2);
        }
        /**
         * 从 approx 信息定位文本并返回 Range
         *
         * 使用模糊匹配算法在容器文本内容中查找 approx.exact，
         * 结合前缀/后缀上下文和位置信息进行评分排名，选择最佳匹配。
         */
        getRangeFromApprox(approx) {
            if (!approx || !approx.exact)
                return null;
            const textContent = this.container.textContent || '';
            if (!textContent)
                return null;
            const getNodeAndOffsetAtPosition = (position) => {
                const walker = document.createTreeWalker(this.container, NodeFilter.SHOW_TEXT, null);
                let currentNode;
                let currentOffset = 0;
                while ((currentNode = walker.nextNode())) {
                    const nodeLength = currentNode.textContent.length;
                    if (currentOffset + nodeLength > position) {
                        return { node: currentNode, offset: position - currentOffset };
                    }
                    currentOffset += nodeLength;
                }
                return null;
            };
            const createRangeFromMatch = (start, end) => {
                const startInfo = getNodeAndOffsetAtPosition(start);
                const endInfo = getNodeAndOffsetAtPosition(end);
                if (!startInfo || !endInfo)
                    return null;
                const range = document.createRange();
                range.setStart(startInfo.node, startInfo.offset);
                range.setEnd(endInfo.node, endInfo.offset);
                return range;
            };
            const calculateSimilarity = (str1, str2) => {
                if (!str1 || !str2)
                    return 0;
                const maxErrors = Math.floor(Math.max(str1.length, str2.length) * 0.3);
                const longer = str1.length < str2.length ? str2 : str1;
                const shorter = str1.length < str2.length ? str1 : str2;
                const matches = search(longer, shorter, maxErrors);
                if (matches.length === 0)
                    return 0;
                const best = matches.reduce((b, c) => c.errors < b.errors ? c : b, matches[0]);
                return 1 - best.errors / str1.length;
            };
            const calculateContextScore = (start, end, expected) => {
                start = Math.max(0, start);
                end = Math.min(textContent.length, end);
                if (start >= end || !expected)
                    return 0;
                const actual = textContent.substring(start, end);
                if (actual.length < expected.length * 0.5)
                    return 0.3;
                return calculateSimilarity(actual, expected);
            };
            // 策略1：精确匹配 + 上下文评分
            const fuzzyMatches = search(textContent, approx.exact, 0);
            if (fuzzyMatches.length > 0) {
                const ranked = fuzzyMatches.map(m => {
                    const prefixScore = calculateContextScore(m.start - (approx.prefix || '').length, m.start, approx.prefix);
                    const suffixScore = calculateContextScore(m.end, m.end + (approx.suffix || '').length, approx.suffix);
                    let positionScore = 0;
                    if (approx.position_start != null && approx.position_end != null) {
                        const distance = Math.abs((m.start + m.end) / 2 - (approx.position_start + approx.position_end) / 2);
                        positionScore = 1 - Math.min(1, distance / (textContent.length / 2));
                    }
                    return { start: m.start, end: m.end, totalScore: prefixScore * 0.4 + suffixScore * 0.4 + positionScore * 0.2 };
                });
                const best = ranked.reduce((b, c) => c.totalScore > b.totalScore ? c : b, ranked[0]);
                if (best.totalScore > 0.3)
                    return createRangeFromMatch(best.start, best.end);
            }
            // 策略2：模糊匹配（允许 2 个字符误差）
            const quoteMatches = search(textContent, approx.exact, 2);
            if (quoteMatches.length > 0) {
                quoteMatches.sort((a, b) => {
                    const aRate = a.errors / (a.end - a.start);
                    const bRate = b.errors / (b.end - b.start);
                    if (aRate !== bRate)
                        return aRate - bRate;
                    return Math.abs(a.end - a.start - approx.exact.length) - Math.abs(b.end - b.start - approx.exact.length);
                });
                return createRangeFromMatch(quoteMatches[0].start, quoteMatches[0].end);
            }
            return null;
        }
        /**
         * 渲染单个 MarkItemInfo
         */
        drawSingleMarkItem(info) {
            const hasStroke = info.stroke.length > 0;
            const hasComment = info.comments.length > 0;
            const userId = info.stroke.length > 0 ? info.stroke[0].userId : info.comments[0]?.userId;
            this.renderer.drawMark(info.id, info.source, hasStroke, hasComment, userId);
        }
        /**
         * 构建返回结果：uuid -> BackendMarkInfo[]
         */
        buildDrawMarksResult(markList) {
            const result = {};
            for (const itemInfo of this.markItemInfos) {
                const relatedMarks = [];
                for (const stroke of itemInfo.stroke) {
                    if (stroke.mark_id) {
                        const mark = markList.find((m) => m.id === stroke.mark_id);
                        if (mark)
                            relatedMarks.push(mark);
                    }
                }
                for (const comment of itemInfo.comments) {
                    const mark = markList.find((m) => m.id === comment.markId);
                    if (mark)
                        relatedMarks.push(mark);
                    for (const child of comment.children) {
                        const childMark = markList.find((m) => m.id === child.markId);
                        if (childMark)
                            relatedMarks.push(childMark);
                    }
                }
                result[itemInfo.id] = relatedMarks;
            }
            return result;
        }
    }

    class DOMPipeline {
        constructor() {
            this.processors = [];
        }
        register(...processors) {
            this.processors.push(...processors);
            return this;
        }
        async run(context) {
            for (const processor of this.processors) {
                try {
                    if (processor.match(context)) {
                        await processor.process(context);
                        console.log(`[DOMPipeline] ${processor.name} executed`);
                    }
                }
                catch (error) {
                    console.error(`[DOMPipeline] ${processor.name} failed:`, error);
                }
            }
        }
    }

    function getImageUrl(element) {
        const tagName = element.tagName.toLowerCase();
        if (tagName === 'img') {
            const img = element;
            return img.currentSrc || img.src || '';
        }
        if (tagName === 'image') {
            const svgImage = element;
            return svgImage.href?.baseVal ||
                element.getAttribute('href') ||
                element.getAttribute('xlink:href') ||
                '';
        }
        return '';
    }
    function handleImageLoading(imgs) {
        const loadingKey = 'slax-image-loading';
        imgs.forEach(img => {
            img.srcset = '';
            img.onload = () => {
                img.classList.remove(loadingKey);
                if (img.naturalWidth < 5 || img.naturalHeight < 5) {
                    img.setAttribute('style', 'display: none;');
                    return;
                }
                else if (img.naturalWidth < 200) {
                    img.setAttribute('style', `width: ${img.naturalWidth}px !important;`);
                    return;
                }
                ['padding: 0 !important', 'height: auto !important;'].forEach(style => {
                    img.setAttribute('style', style);
                });
            };
            img.referrerPolicy = '';
            img.onerror = () => {
                img.classList.remove(loadingKey);
                img.style.display = 'none';
            };
            img.classList.add(loadingKey);
            const parentElement = img.parentElement;
            const parentChilds = parentElement ? Array.from(parentElement.childNodes) : [];
            const isOnlyImages = parentChilds.every(child => {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    const element = child;
                    return element.tagName.toLowerCase() === 'img';
                }
                return true;
            });
            if (isOnlyImages) {
                img.style.cssFloat = 'none';
            }
        });
    }
    function unwrapImgAnchorsInTweet(doc) {
        const firstDiv = doc.body?.querySelector(':scope > div');
        if (!firstDiv?.classList.contains('tweet'))
            return;
        doc.querySelectorAll('a img').forEach(img => {
            const anchor = img.closest('a');
            if (!anchor)
                return;
            const parent = anchor.parentNode;
            if (!parent)
                return;
            while (anchor.firstChild) {
                parent.insertBefore(anchor.firstChild, anchor);
            }
            parent.removeChild(anchor);
        });
    }
    class ImageClickProcessor {
        constructor() {
            this.name = 'ImageClickProcessor';
        }
        match(context) {
            return context.document.querySelectorAll('img, image').length > 0;
        }
        process(context) {
            const doc = context.document;
            unwrapImgAnchorsInTweet(doc);
            const allImages = doc.querySelectorAll('img, image');
            const images = [];
            allImages.forEach(img => {
                const url = getImageUrl(img);
                if (!url) {
                    if (img.tagName.toLowerCase() === 'img') {
                        img.style.display = 'none';
                    }
                    return;
                }
                images.push(img);
            });
            const htmlImages = images.filter(img => img.tagName.toLowerCase() === 'img');
            handleImageLoading(htmlImages);
            images.forEach(img => {
                img.addEventListener('click', (event) => {
                    const validSchemes = ['https://', 'http://', 'slaxstatics://', 'slaxstatic://'];
                    const allImageUrls = images
                        .map(getImageUrl)
                        .filter(url => url && validSchemes.some(scheme => url.startsWith(scheme)));
                    const currentTarget = event.currentTarget;
                    const clickedImageUrl = getImageUrl(currentTarget);
                    postToNativeBridge({
                        type: 'imageClick',
                        src: clickedImageUrl,
                        allImages: allImageUrls,
                        index: allImageUrls.indexOf(clickedImageUrl)
                    });
                });
            });
            console.log(`[ImageClickProcessor] Initialized ${images.length} image click handlers`);
        }
    }

    class BookmarkNotFoundProcessor {
        constructor() {
            this.name = 'BookmarkNotFoundProcessor';
        }
        match(context) {
            return !!context.document.querySelector('body > .slax-reader-notfound-container > .slax-reader-notfound-btn-container');
        }
        process(context) {
            const container = context.document.querySelector('body > .slax-reader-notfound-container > .slax-reader-notfound-btn-container');
            const retryBtn = container.querySelector('.retry-btn');
            const feedbackBtn = container.querySelector('.feedback-btn');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => {
                    postToNativeBridge({ type: 'refreshContent' });
                    console.log('[BookmarkNotFoundProcessor] Retry button clicked');
                });
            }
            if (feedbackBtn) {
                feedbackBtn.addEventListener('click', () => {
                    postToNativeBridge({ type: 'feedback' });
                    console.log('[BookmarkNotFoundProcessor] Feedback button clicked');
                });
            }
            console.log('[BookmarkNotFoundProcessor] Initialized bookmark not found handlers');
        }
    }

    class SpanProcessor {
        constructor() {
            this.name = 'SpanProcessor';
        }
        match(context) {
            return context.document.querySelectorAll('span').length > 0;
        }
        process(context) {
            const spans = context.document.querySelectorAll('span');
            spans.forEach(span => {
                const el = span;
                if (el.textContent?.replace(/ /g, '').trim().length === 0 &&
                    !el.querySelector('img[src], video[src], picture:has(source[srcset]), svg, canvas')) {
                    el.style.display = 'none';
                }
            });
            console.log(`[SpanProcessor] Processed ${spans.length} span elements`);
        }
    }

    class ListProcessor {
        constructor() {
            this.name = 'ListProcessor';
        }
        match(context) {
            return context.document.querySelectorAll('ul').length > 0;
        }
        process(context) {
            const uls = context.document.querySelectorAll('ul');
            uls.forEach(ul => {
                if (ul.querySelector('li')) {
                    ul.classList.add('has-li');
                }
            });
            console.log(`[ListProcessor] Processed ${uls.length} ul elements`);
        }
    }

    class SvgProcessor {
        constructor() {
            this.name = 'SvgProcessor';
        }
        match(context) {
            return context.document.querySelectorAll('svg').length > 0;
        }
        process(context) {
            const svgs = context.document.querySelectorAll('svg');
            svgs.forEach(svg => {
                const el = svg;
                const paths = el.getElementsByTagName('path');
                if (paths.length < 10) {
                    el.setAttribute('style', 'display: none;');
                    return;
                }
                const viewBox = el.viewBox;
                if (!viewBox)
                    return;
                const { width, height } = viewBox.baseVal;
                if (width < 5 || height < 5) {
                    el.setAttribute('style', 'display: none;');
                }
                else {
                    el.setAttribute('style', `width: ${width}px !important; height: ${height}px !important;`);
                }
            });
            console.log(`[SvgProcessor] Processed ${svgs.length} svg elements`);
        }
    }

    // 标记纯空白容器，CSS :has(>.oc-blank-flag) 隐藏
    // 移植自 dweb BlankMarkProcessor（去 SSR）
    const CANDIDATE_SELECTOR = 'section, p, figure, h1, h2, h3, h4, div';
    // 含这些视觉元素则不算空白
    const VISUAL_SELECTOR = 'img, video, svg, iframe, picture, canvas, audio, object, embed, table';
    const BLANK_FLAG_CLASS = 'oc-blank-flag';
    function isBlankText(text) {
        return text.trim().length === 0;
    }
    // 内联 display:none 也当空白
    function isStyleHidden(styleAttr) {
        return /display\s*:\s*none\b/i.test(styleAttr ?? '');
    }
    class BlankMarkProcessor {
        constructor() {
            this.name = 'BlankMarkProcessor';
        }
        match() {
            return true;
        }
        process(context) {
            // 只处理正文容器 body>div
            const root = context.document.body?.querySelector(':scope > div');
            if (!root)
                return;
            const markBlank = (el) => {
                const marker = context.document.createElement('template');
                marker.className = BLANK_FLAG_CLASS;
                el.appendChild(marker);
            };
            const candidates = Array.from(root.querySelectorAll(CANDIDATE_SELECTOR));
            for (const el of candidates) {
                // 幂等
                if (el.querySelector(`:scope > .${BLANK_FLAG_CLASS}`))
                    continue;
                // 内联隐藏直接当空白
                if (isStyleHidden(el.getAttribute('style'))) {
                    markBlank(el);
                    continue;
                }
                if (el.querySelector(VISUAL_SELECTOR))
                    continue;
                if (!isBlankText(el.textContent ?? ''))
                    continue;
                markBlank(el);
            }
            console.log(`[BlankMarkProcessor] Processed ${candidates.length} candidate elements`);
        }
    }

    // 给多行 <p> 落 marker，CSS 转 pre-line
    // 移植自 dweb PreLineProcessor（去 SSR）
    // 只匹配换行控制符，不匹配文字 \n
    const LINE_BREAK_RE = /\r\n|[\n\r\v\f\x85\u2028\u2029]/;
    const PRELINE_FLAG_CLASS = 'oc-preline-flag';
    // 有内容的行 ≥ 2 才算多行
    function isMultiLine(text) {
        return (text
            .split(LINE_BREAK_RE)
            .map(line => line.trim())
            .filter(Boolean).length >= 2);
    }
    class PreLineProcessor {
        constructor() {
            this.name = 'PreLineProcessor';
        }
        match() {
            return true;
        }
        process(context) {
            // 只处理正文容器 body>div
            const root = context.document.body?.querySelector(':scope > div');
            if (!root)
                return;
            const paragraphs = Array.from(root.querySelectorAll('p'));
            for (const el of paragraphs) {
                // 幂等
                if (el.querySelector(`:scope > .${PRELINE_FLAG_CLASS}`))
                    continue;
                if (!isMultiLine(el.textContent ?? ''))
                    continue;
                const marker = context.document.createElement('template');
                marker.className = PRELINE_FLAG_CLASS;
                el.appendChild(marker);
            }
            console.log(`[PreLineProcessor] Processed ${paragraphs.length} p elements`);
        }
    }

    // 含 <summary> 的 <details> 自动展开（移植自 dweb）
    class DetailsProcessor {
        constructor() {
            this.name = 'DetailsProcessor';
        }
        match() {
            return true;
        }
        process(context) {
            const details = Array.from(context.document.querySelectorAll('details'));
            details.forEach(detail => {
                if (detail.querySelector('summary')) {
                    detail.open = true;
                }
            });
            console.log(`[DetailsProcessor] Processed ${details.length} details elements`);
        }
    }

    class DefaultDOMHandler {
        constructor() {
            this.pipeline = new DOMPipeline();
            this.pipeline.register(new ImageClickProcessor(), new BookmarkNotFoundProcessor(), new SvgProcessor(), new SpanProcessor(), new ListProcessor(), new BlankMarkProcessor(), new PreLineProcessor(), new DetailsProcessor());
        }
        async run() {
            await this.pipeline.run({ document });
        }
    }

    class WechatHeaderProcessor {
        constructor() {
            this.name = 'WechatHeaderProcessor';
        }
        match(context) {
            if (!context.infoPack)
                return false;
            const metadataUrl = String(context.infoPack.metadataUrl ?? '');
            return metadataUrl.startsWith('https://mp.weixin.qq.com');
        }
        process(context) {
            const doc = context.document;
            const isFirstElementChain = (el) => {
                let current = el;
                while (current) {
                    const parent = current.parentElement;
                    if (!parent)
                        return false;
                    const isContainer = parent.tagName.toLowerCase() === 'body' || (parent.tagName.toLowerCase() === 'div' && parent.classList.contains('html-text'));
                    if (isContainer) {
                        return parent.firstElementChild === current;
                    }
                    if (parent.firstElementChild !== current)
                        return false;
                    current = parent;
                }
                return false;
            };
            const hideP = (anchor) => {
                const p = anchor.closest('p');
                if (p && isFirstElementChain(p)) {
                    p.style.display = 'none';
                }
            };
            const metaSpan = doc.querySelector('span#meta_content_hide_info');
            if (metaSpan) {
                hideP(metaSpan);
                return;
            }
            const fallback = doc.querySelector('span#profileBt') || doc.querySelector('span#copyright_logo');
            if (fallback) {
                hideP(fallback);
            }
        }
    }

    class InfoPackDOMHandler {
        constructor() {
            this.pipeline = new DOMPipeline();
            this.pipeline.register(new WechatHeaderProcessor());
        }
        async run(infoPack) {
            await this.pipeline.run({ document, infoPack });
        }
    }

    const BRIDGE_VERSION = '1.0.0';
    class SlaxWebViewBridge {
        constructor() {
            this.infoPackReceived = false;
            // selection 相关状态
            this.selectionMonitor = null;
            this.markManager = null;
            this.selectionContainer = null;
            this.markClickCleanup = null;
            this.onMarkTap = null;
            this.onMarkItemInfosChange = null;
            this.postMessage = postToNativeBridge;
            this.getContentHeight = getContentHeight;
            this.scrollToAnchor = (anchorText) => {
                const didScroll = scrollToAnchor(anchorText, () => {
                    this.selectionMonitor?.prepareForProgrammaticSelection();
                });
                if (didScroll) {
                    this.selectionMonitor?.suppressCurrentSelection();
                }
                return didScroll;
            };
            this.highlightElement = highlightElement;
            this.findMatchingElement = findMatchingElement;
            this.scrollToElement = scrollToElement;
            this.defaultHandler = new DefaultDOMHandler();
            this.infoPackHandler = new InfoPackDOMHandler();
            this.init();
        }
        getVersion() {
            return BRIDGE_VERSION;
        }
        init() {
            applyPolyfills();
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    this.onDOMReady();
                });
            }
            else {
                this.onDOMReady();
            }
            console.log('[WebView Bridge] Bridge initialized successfully');
        }
        async onDOMReady() {
            await this.defaultHandler.run();
            postToNativeBridge({
                type: 'domReady'
            });
            this.requestInfoPack();
            setTimeout(() => {
                if (!this.infoPackReceived) {
                    console.warn('[WebView Bridge] InfoPack response timeout, skipping infoPack processors');
                }
            }, 5000);
            console.log('[WebView Bridge] DOM ready event sent to native bridge');
        }
        requestInfoPack() {
            postToNativeBridge({ type: 'requestInfoPack' });
        }
        receiveInfoPack(infoPackJson) {
            this.infoPackReceived = true;
            try {
                const infoPack = JSON.parse(infoPackJson);
                this.infoPackHandler.run(infoPack);
            }
            catch (error) {
                console.error('[WebView Bridge] Failed to parse info pack:', error);
            }
        }
        // ==================== 划线选择功能 ====================
        /**
         * 开始监听文本选择
         * @param containerSelector 监听容器的 CSS 选择器
         * @param currentUserId 当前用户ID（可选，用于判断是否为自己的划线）
         */
        startSelectionMonitoring(containerSelector, currentUserId) {
            const container = document.querySelector(containerSelector);
            if (!container) {
                console.error(`[WebView Bridge] Container not found: ${containerSelector}`);
                return;
            }
            // 如果已有监听器，先停止
            this.stopSelectionMonitoring();
            this.selectionContainer = container;
            // 追踪 touchstart 位置，供每个 slax-mark 的 touchend 回调做滚动判断
            let touchStartX = 0;
            let touchStartY = 0;
            const trackTouchStart = (e) => {
                if (e.touches.length === 1) {
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                }
            };
            document.addEventListener('touchstart', trackTouchStart, { passive: true });
            this.markClickCleanup = () => document.removeEventListener('touchstart', trackTouchStart);
            /**
             * 每个 slax-mark 元素绑定此回调（在 MarkRenderer 内直接 addEventListener）。
             * 在元素自身的 touchend 中判断：选区是否为空、手指是否移动过大，
             * 再聚合同 UUID 所有 mark 的文本发送给 native。
             */
            const onMarkTap = (markId, event) => {
                if (event.changedTouches.length === 0)
                    return;
                // 若点击目标属于某个更内层的 slax-mark，则外层 mark 的回调跳过
                const innerMark = event.target.closest('slax-mark');
                if (innerMark && innerMark.dataset.uuid !== markId)
                    return;
                // 有文本选中说明用户在选词，不触发划线点击
                const selection = window.getSelection();
                if (selection && !selection.isCollapsed)
                    return;
                const touch = event.changedTouches[0];
                const dx = Math.abs(touch.clientX - touchStartX);
                const dy = Math.abs(touch.clientY - touchStartY);
                // 移动超过 10px 视为滚动
                if (dx > 10 || dy > 10)
                    return;
                const allMarks = Array.from(container.querySelectorAll(`slax-mark[data-uuid="${markId}"]`));
                const fullText = allMarks.map((el) => {
                    const firstChild = el.firstElementChild;
                    if (firstChild?.tagName === 'IMG')
                        return ` 🖼️ ${el.textContent}`;
                    return el.textContent || '';
                }).join('');
                const markItemInfo = this.markManager?.getMarkItemInfoByUuid(markId) ?? null;
                postToNativeBridge({
                    type: 'markClicked',
                    markId,
                    text: fullText,
                    data: markItemInfo ? JSON.stringify(markItemInfo) : null
                });
            };
            this.onMarkTap = onMarkTap;
            /**
             * markItemInfos 数据变化时，通过 native bridge 通知原生端
             */
            const onMarkItemInfosChange = (markItemInfos) => {
                console.log('[WebView Bridge] MarkItemInfos changed, count:', markItemInfos.length);
                postToNativeBridge({
                    type: 'markItemInfosChanged',
                    markItemInfos: JSON.stringify(markItemInfos)
                });
            };
            this.onMarkItemInfosChange = onMarkItemInfosChange;
            this.markManager = new MarkManager(container, currentUserId, onMarkTap, onMarkItemInfosChange);
            this.selectionMonitor = new SelectionMonitor(container);
            this.selectionMonitor.start((data) => {
                const markItemInfo = this.markManager?.resolveMarkItemInfo(data.paths, data.approx) ?? null;
                postToNativeBridge({
                    type: 'textSelected',
                    data: markItemInfo ? JSON.stringify(markItemInfo) : null,
                });
            }, () => {
                postToNativeBridge({ type: 'textDeselected' });
            });
            console.log(`[WebView Bridge] Selection monitoring started on: ${containerSelector}`);
        }
        /**
         * 停止监听文本选择
         */
        stopSelectionMonitoring() {
            if (this.selectionMonitor) {
                this.selectionMonitor.stop();
                this.selectionMonitor = null;
            }
            if (this.markClickCleanup) {
                this.markClickCleanup();
                this.markClickCleanup = null;
            }
            this.selectionContainer = null;
            this.markManager = null;
            this.onMarkItemInfosChange = null;
        }
        /**
         * 清除当前文本选择
         */
        clearSelection() {
            this.selectionMonitor?.clearSelection();
        }
        /**
         * 批量绘制标记（从后端 MarkDetail 数据）
         * @param markDetailJson MarkDetail 的 JSON 字符串
         * @returns DrawMarksResult 的 JSON 字符串：{ uuid: BackendMarkInfo[] }
         */
        drawMarks(markDetailJson) {
            if (!this.markManager) {
                console.warn('[WebView Bridge] drawMarks: selection monitoring not started');
                return JSON.stringify({});
            }
            try {
                const markDetail = JSON.parse(markDetailJson);
                const result = this.markManager.drawMarks(markDetail);
                return JSON.stringify(result);
            }
            catch (error) {
                postToNativeBridge({ type: 'selectionError', error: `Failed to draw marks: ${error}` });
                return JSON.stringify({});
            }
        }
        /**
         * 获取当前选区数据（不执行划线渲染）
         *
         * 仅读取当前选区并返回接口所需的数据结构，不进行本地渲染和幂等处理。
         *
         * @returns 选区数据的 JSON 字符串，或 null
         */
        captureCurrentSelection() {
            if (!this.markManager) {
                console.warn('[WebView Bridge] captureCurrentSelection: selection monitoring not started');
                return null;
            }
            try {
                const result = this.markManager.captureCurrentSelection();
                return result ? JSON.stringify(result) : null;
            }
            catch (error) {
                postToNativeBridge({ type: 'selectionError', error: `Failed to capture selection: ${error}` });
                return null;
            }
        }
        /**
         * 设置当前用户ID（会重建内部 renderer/manager）
         */
        setCurrentUserId(userId) {
            if (this.selectionContainer) {
                this.markManager = new MarkManager(this.selectionContainer, userId, this.onMarkTap ?? undefined, this.onMarkItemInfosChange ?? undefined);
            }
        }
    }

    exports.SlaxWebViewBridge = SlaxWebViewBridge;

    return exports;

})({});
window.SlaxWebViewBridge = new SlaxReaderWebBridgeExports.SlaxWebViewBridge();
