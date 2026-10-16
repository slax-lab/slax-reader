package com.slax.reader.ui.bookmark

import androidx.compose.runtime.*
import com.slax.reader.ui.bookmark.components.DetailScreenSkeleton
import com.slax.reader.ui.bookmark.states.LocalMarkInteraction
import com.slax.reader.ui.bookmark.states.MarkInteractionState
import com.slax.reader.ui.bookmark.states.ScrollInfo
import com.slax.reader.utils.*
import com.slax.reader.ui.AppLifecycle
import kotlinx.coroutines.delay
import org.koin.compose.viewmodel.koinViewModel

val LocalToolbarVisible = compositionLocalOf<MutableState<Boolean>> {
    error("LocalToolbarVisible not provided")
}

private const val WEBVIEW_MOUNT_DELAY_MS = 250L

sealed interface DetailScreenEvent {
    data object BackClick : DetailScreenEvent
    data object NavigateToSubscription : DetailScreenEvent
    data class NavigateToFeedback(val params: FeedbackPageParams) : DetailScreenEvent
}

@Composable
fun DetailScreen(
    bookmarkId: String,
    collectionOwnerId: String? = null,
    collectionId: String? = null,
    onEvent: (DetailScreenEvent) -> Unit,
    viewModel: BookmarkDetailViewModel? = null,
    lifecycle: AppLifecycle = LifeCycleHelper,
    webViewHost: com.slax.reader.ui.WebViewHost = com.slax.reader.ui.PlatformWebViewHost,
    rssEntryId: String? = null,
) {
    if (rssEntryId != null) {
        RssReader(rssEntryId, onBack = { onEvent(DetailScreenEvent.BackClick) }, webViewHost = webViewHost)
        return
    }
    val resolvedViewModel = viewModel ?: koinViewModel<BookmarkDetailViewModel>()
    val coroutineScope = rememberCoroutineScope()

    val toolbarVisible = remember { mutableStateOf(true) }
    val scrollInfo = remember { mutableStateOf(ScrollInfo(0f, false)) }
    val markInteraction = remember { MarkInteractionState() }

    val webViewState = rememberAppWebViewState(coroutineScope)

    LaunchedEffect(bookmarkId, collectionOwnerId, collectionId) {
        resolvedViewModel.bind(bookmarkId, collectionOwnerId, collectionId)

        resolvedViewModel.effects.collect { effect ->
            when (effect) {
                BookmarkDetailEffect.NavigateBack -> onEvent(DetailScreenEvent.BackClick)
                BookmarkDetailEffect.NavigateToSubscription -> onEvent(DetailScreenEvent.NavigateToSubscription)
                is BookmarkDetailEffect.NavigateToFeedback -> {
                    onEvent(DetailScreenEvent.NavigateToFeedback(effect.params))
                }
                is BookmarkDetailEffect.ScrollToAnchor -> {
                    webViewState.scrollToAnchor(effect.anchor)
                }
                is BookmarkDetailEffect.DrawMarks -> {
                    webViewState.evaluateJs(
                        "window.SlaxWebViewBridge.drawMarks(`${escapeJsTemplateString(effect.markDetailJson)}`)"
                    )
                }
                is BookmarkDetailEffect.SeekYoutube -> {
                    webViewState.evaluateJs("window.__slaxSeekYoutube && window.__slaxSeekYoutube(${effect.seconds})")
                }
                BookmarkDetailEffect.QueryYoutubeTime -> {
                    // 查询当前播放秒数，回填给字幕面板用于定位当前行
                    webViewState.evaluateJsWithCallback("window.__slaxGetYoutubeTime ? window.__slaxGetYoutubeTime() : -1") { result ->
                        // 不同平台可能返回 "12" / "12.0" / "\"12\""，做容错解析
                        val seconds = result.trim().trim('"').substringBefore('.').toIntOrNull() ?: -1
                        resolvedViewModel.setYoutubeCurrentTime(seconds)
                    }
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        lifecycle.state.collect { state ->
            when (state) {
                AppLifecycleState.ON_STOP -> {
                    resolvedViewModel.flushReadPosition()
                    resolvedViewModel.flushOutlineScrollPosition()
                    resolvedViewModel.onStopRecordContinue()
                }
                AppLifecycleState.ON_RESUME -> {
                    resolvedViewModel.onResumeClearContinue()
                }
                else -> {}
            }
        }
    }

    LaunchedEffect(webViewState) {
        webViewState.events.collect { event ->
            when (event) {
                is WebViewEvent.ImageClick -> {
                    resolvedViewModel.overlayDelegate.onWebViewImageClick(event.src, event.allImages)
                }
                is WebViewEvent.Tap -> {
                    val info = scrollInfo.value
                    if (!info.isNearBottom && info.scrollY > 10f) {
                        toolbarVisible.value = !toolbarVisible.value
                    }
                }
                is WebViewEvent.RefreshContent -> {
                    resolvedViewModel.refreshContent()
                }
                is WebViewEvent.Feedback -> {
                    println("feedback")
                }
                is WebViewEvent.TextSelected -> {
                    markInteraction.onTextSelected(event.text, event.selectionY, event.markItemInfo)
                }
                is WebViewEvent.TextDeselected -> {
                    markInteraction.onTextDeselected()
                }
                is WebViewEvent.PageLoaded -> {
                    val userIdLong = resolvedViewModel.commentDelegate.currentUserIdLong
                    webViewState.evaluateJs("window.SlaxWebViewBridge.startSelectionMonitoring('body', $userIdLong)")
                    resolvedViewModel.startObservingMarks()
                }
                is WebViewEvent.MarkClicked -> {
                    val info = event.markItemInfo ?: return@collect
                    markInteraction.onMarkClicked(event.text, info)
                    resolvedViewModel.commentDelegate.setSelectedMark(info.source)
                }
                is WebViewEvent.MarkItemInfosChanged -> {
                    markInteraction.onMarkItemInfosChanged(event.markItemInfos)
                }
                else -> {}
            }
        }
    }

    LaunchedEffect(Unit) {
        snapshotFlow { scrollInfo.value }
            .collect { info ->
                toolbarVisible.value = when {
                    info.isNearBottom -> true
                    info.scrollY <= 10f -> true
                    else -> false
                }
                resolvedViewModel.saveReadPosition(info.scrollY)
            }
    }

    val contentState by resolvedViewModel.contentState.collectAsState()

    var transitionSettled by remember { mutableStateOf(false) }
    LaunchedEffect(bookmarkId) {
        transitionSettled = false
        delay(WEBVIEW_MOUNT_DELAY_MS)
        transitionSettled = true
    }

    if (contentState.htmlContent == null || contentState.isLoading || !transitionSettled) {
        DetailScreenSkeleton()
        return
    }

    CompositionLocalProvider(
        LocalToolbarVisible provides toolbarVisible,
        LocalMarkInteraction provides markInteraction,
    ) {
        DetailScreen(
            bookmarkId = contentState.cacheKey,
            htmlContent = contentState.htmlContent!!,
            webViewState = webViewState,
            onScrollInfoChanged = { scrollInfo.value = it },
            viewModel = resolvedViewModel,
            webViewHost = webViewHost,
        )
    }
}

@Composable
expect fun DetailScreen(
    bookmarkId: String,
    htmlContent: String,
    webViewState: AppWebViewState,
    onScrollInfoChanged: (ScrollInfo) -> Unit,
    viewModel: BookmarkDetailViewModel? = null,
    webViewHost: com.slax.reader.ui.WebViewHost = com.slax.reader.ui.PlatformWebViewHost,
    rssPreview: RssReaderState? = null,
)
