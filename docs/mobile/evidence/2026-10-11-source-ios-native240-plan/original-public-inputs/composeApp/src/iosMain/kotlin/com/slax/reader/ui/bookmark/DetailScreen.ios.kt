package com.slax.reader.ui.bookmark

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.FrameRateCategory
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.preferredFrameRate
import androidx.compose.ui.unit.dp
import com.slax.reader.ui.bookmark.components.*
import com.slax.reader.ui.bookmark.states.LocalMarkInteraction
import com.slax.reader.ui.bookmark.states.ScrollInfo
import com.slax.reader.ui.WebViewHost
import com.slax.reader.ui.bookmark.BookmarkDetailViewModel
import com.slax.reader.utils.*
import kotlinx.serialization.Serializable
import org.koin.compose.viewmodel.koinViewModel
import kotlin.math.max
import platform.UIKit.UIPasteboard

@Serializable
data class WebViewMessage(
    val type: String,
    val height: Int? = null,
    val src: String? = null,
    val allImages: List<String>? = null,
    val percentage: Double? = null,

    val productId: String? = null,
    val orderId: String? = null,
    val offerId: String? = null,
    val keyID: String? = null,
    val nonce: String? = null,
    val signature: String? = null,
    val timestamp: Long? = null,

    val text: String? = null,
    val selectionY: Float? = null,
    val markId: String? = null,
    val markItemInfos: String? = null,
    val data: String? = null,
)

@Composable
actual fun DetailScreen(
    bookmarkId: String,
    htmlContent: String,
    webViewState: AppWebViewState,
    onScrollInfoChanged: (ScrollInfo) -> Unit,
    viewModel: BookmarkDetailViewModel?,
    webViewHost: WebViewHost,
    rssPreview: RssReaderState?,
) {
    println("[watch][UI] recomposition DetailScreen.ios")

    val viewModel = if (rssPreview == null) viewModel ?: koinViewModel<BookmarkDetailViewModel>() else null

    val wrappedHtmlContent = remember(htmlContent) { wrapBookmarkDetailHtml(htmlContent) }

    // WebView 滚动偏移
    val webViewScrollY = remember { mutableFloatStateOf(0f) }

    var contentHeightPx by remember { mutableFloatStateOf(0f) }
    var visibleHeightPx by remember { mutableFloatStateOf(0f) }

    // 顶部内容高度 (px)
    val headerMeasuredHeightState = remember { mutableFloatStateOf(0f) }

    var footerHeightPx by remember { mutableFloatStateOf(0f) }
    val rssHeaderInsetPx = headerMeasuredHeightState.floatValue + WindowInsets.statusBars.getTop(LocalDensity.current)
    val showRssFooter = rssPreview != null && visibleHeightPx > 0f &&
        contentHeightPx + rssHeaderInsetPx > visibleHeightPx
    LaunchedEffect(showRssFooter, footerHeightPx) {
        webViewState.bottomContentInsetPx = if (showRssFooter) footerHeightPx else 0f
    }
    DisposableEffect(webViewState) { onDispose { webViewState.bottomContentInsetPx = 0f } }

    val bottomThresholdPx = with(LocalDensity.current) { 100.dp.toPx() }

    // 距离底部的距离
    val isNearBottom by remember {
        derivedStateOf {
            val distanceToBottom = contentHeightPx - (webViewScrollY.floatValue + visibleHeightPx) + headerMeasuredHeightState.floatValue
            distanceToBottom < bottomThresholdPx
        }
    }

    LaunchedEffect(Unit) {
        snapshotFlow { webViewScrollY.floatValue to isNearBottom }
            .collect { (scrollY, nearBottom) ->
                onScrollInfoChanged(ScrollInfo(scrollY, nearBottom))
            }
    }

    val headerVisible by remember {
        derivedStateOf {
            headerMeasuredHeightState.floatValue == 0f || webViewScrollY.floatValue < headerMeasuredHeightState.floatValue
        }
    }

    // 设置 webState 的参数
    LaunchedEffect(headerMeasuredHeightState.floatValue) {
        webViewState.topContentInsetPx = headerMeasuredHeightState.floatValue
    }

    val density = LocalDensity.current
    val densityScale = density.density

    val windowInsets = WindowInsets.statusBars
    val statusBarHeightPx = windowInsets.getTop(density).toFloat()

    LaunchedEffect(webViewState) {
        webViewState.events.collect { event ->
            when (event) {
                is WebViewEvent.PageLoaded -> {
                    viewModel?.consumeInitialReadPosition()?.let { position ->
                        val totalInsetPx = webViewState.topContentInsetPx + statusBarHeightPx
                        val positionPoints = (position - totalInsetPx) / densityScale
                        webViewState.evaluateJs("window.scrollTo(0, $positionPoints)")
                    }
                }
                is WebViewEvent.ScrollChange -> {
                    webViewScrollY.floatValue = max(event.scrollY, 0f)
                    contentHeightPx = event.contentHeight
                    visibleHeightPx = event.visibleHeight
                }
                is WebViewEvent.ScrollToPosition -> {
                    val totalInsetPx = webViewState.topContentInsetPx + statusBarHeightPx
                    println(totalInsetPx / densityScale)
                    webViewState.evaluateJs("window.scrollTo(0, Math.max(0,document.body.scrollHeight * ${event.percentage} - ${totalInsetPx / densityScale}))")
                }
                is WebViewEvent.ScrollToTop -> {
                    webViewState.evaluateJs("window.scrollTo({ top: 0, behavior: 'smooth' })")
                }
                else -> {}
            }
        }
    }

    val onHeightChanged = remember {
        { height: Float -> headerMeasuredHeightState.floatValue = height }
    }

    var containerHeightPx by remember { mutableFloatStateOf(0f) }
    val markInteraction = LocalMarkInteraction.current
    val clearSelection = remember(webViewState, markInteraction) {
        {
            markInteraction.onTextDeselected()
            webViewState.evaluateJs("window.SlaxWebViewBridge.clearSelection()")
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFFCFCFC))
            .onSizeChanged { containerHeightPx = it.height.toFloat() }
    ) {
        key(bookmarkId) {
            webViewHost.Html(
                htmlContent = wrappedHtmlContent,
                modifier = Modifier.fillMaxSize().preferredFrameRate(FrameRateCategory.High),
                webState = webViewState,
                bookmarkId = bookmarkId
            )
        }

        if (headerVisible) {
            Box(
                modifier = Modifier.graphicsLayer {
                    translationY = -webViewScrollY.floatValue
                }
            ) {
                HeaderContent(onHeightChanged = onHeightChanged, rssPreview = rssPreview)
            }
        }

        if (rssPreview != null && showRssFooter) {
            RssReaderFooter(
                rssPreview,
                Modifier.onSizeChanged { footerHeightPx = it.height.toFloat() }.graphicsLayer {
                    translationY = rssHeaderInsetPx + contentHeightPx - webViewScrollY.floatValue
                },
            )
        }

        NavigatorBar(onClearSelection = clearSelection, onBackOverride = rssPreview?.onBack)

        if (viewModel != null) {
            FloatingActionBar(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(bottom = 24.dp),
                onClearSelection = clearSelection,
            )

            // 当评论面板显示时，禁用状态栏点击触发的 scrollsToTop 行为，
            // 防止点击状态栏区域导致背后的 WebView 滚动到顶部
            LaunchedEffect(markInteraction.panelVisible) {
                webViewState.webView?.scrollView?.scrollsToTop = !markInteraction.panelVisible
            }

            OutlineDialog(onClearSelection = clearSelection)

            TranscriptDialog()

            SelectionMenuCommentPanel(
                markInteraction = markInteraction,
                webViewState = webViewState,
                viewModel = viewModel,
                densityScale = densityScale,
                containerHeightPx = containerHeightPx,
                minTopPx = (statusBarHeightPx + 20.dp.value * densityScale).toInt(),
                onCopyText = { UIPasteboard.generalPasteboard.string = it },
                onHighlightAction = {
                    val markInfo = markInteraction.capturedSelectionMark
                    if (markInfo != null) {
                        viewModel.addStrokeToMark(
                            markItemInfo = markInfo,
                            onComplete = {
                                webViewState.evaluateJs("window.SlaxWebViewBridge.clearSelection()")
                            }
                        )
                    } else {
                        viewModel.strokeHighlight(webViewState) {
                            webViewState.evaluateJs("window.SlaxWebViewBridge.clearSelection()")
                        }
                    }
                },
                onSubmitCommentComplete = {
                    webViewState.evaluateJs("window.SlaxWebViewBridge.clearSelection()")
                },
            )
        }
    }

    if (viewModel != null) BookmarkDetailOverlays()
}
