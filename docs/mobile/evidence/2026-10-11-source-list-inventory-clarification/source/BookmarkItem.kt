package com.slax.reader.ui.inbox.compenents

import androidx.compose.animation.core.*
import androidx.compose.foundation.Image
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.slax.reader.data.database.model.BookmarkSortType
import com.slax.reader.data.database.model.InboxListBookmarkItem
import com.slax.reader.data.database.model.ListRowBookmark
import com.slax.reader.ui.inbox.InboxListViewModel
import com.slax.reader.utils.bookmarkListEvent
import com.slax.reader.utils.FirstPartyEventReporter
import com.slax.reader.utils.i18n
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.painterResource
import slax_reader_client.composeapp.generated.resources.*
import kotlin.math.abs

data class SwipeActionsConfig(
    val showStarAction: Boolean,
    val showArchiveAction: Boolean,
    val maxSwipeWidthDp: Dp,
    val sortType: BookmarkSortType,
)

fun BookmarkSortType.toSwipeConfig(): SwipeActionsConfig = when (this) {
    BookmarkSortType.UPDATED -> SwipeActionsConfig(
        showStarAction = true,
        showArchiveAction = true,
        maxSwipeWidthDp = 130.dp,
        sortType = this,
    )
    BookmarkSortType.STARRED -> SwipeActionsConfig(
        showStarAction = true,
        showArchiveAction = false,
        maxSwipeWidthDp = 70.dp,
        sortType = this,
    )
    BookmarkSortType.ARCHIVED -> SwipeActionsConfig(
        showStarAction = false,
        showArchiveAction = true,
        maxSwipeWidthDp = 70.dp,
        sortType = this,
    )
}

// 菜单触发源枚举
enum class MenuTriggerSource {
    NONE,           // 未触发
    LONG_PRESS,     // 长按触发
    MORE_ICON       // 点击更多触发
}

data class BookmarkRowOwnerActions(
    val bookmark: InboxListBookmarkItem,
    val swipeConfig: SwipeActionsConfig,
    val onEditTitle: (InboxListBookmarkItem) -> Unit,
)

@Composable
fun BookmarkItemRow(
    item: ListRowBookmark,
    onClick: () -> Unit,
    viewModel: InboxListViewModel,
    ownerActions: BookmarkRowOwnerActions? = null,
) {
    val firstPartyEvents: FirstPartyEventReporter = org.koin.compose.koinInject()
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val swipeConfig = ownerActions?.swipeConfig

    var menuTriggerSource by remember { mutableStateOf(MenuTriggerSource.NONE) }
    val showMenu by remember {
        derivedStateOf { menuTriggerSource != MenuTriggerSource.NONE }
    }

    // 闪烁动画
    val flashAlpha = remember { Animatable(0f) }
    var currentTitle by remember { mutableStateOf("") }

    LaunchedEffect(item.displayTitle()) {
        if (currentTitle.isEmpty()) currentTitle = item.displayTitle()
        if (flashAlpha.value == 0f && currentTitle != item.displayTitle()) {
            repeat(3) {
                flashAlpha.animateTo(0.05f, tween(180))
                flashAlpha.animateTo(0f, tween(180))
            }
            currentTitle = item.displayTitle()
        }
    }

    var boxSize by remember { mutableStateOf(IntSize.Zero) }
    var isDragging by remember { mutableStateOf(false) }
    var totalDragDistance by remember { mutableStateOf(0f) }
    var dragStartOffset by remember { mutableStateOf(0f) }

    // 点击交互状态
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()
    var isLongPressed by remember { mutableStateOf(false) }

    // 动画效果
    val elevation by animateFloatAsState(
        targetValue = if (isLongPressed) 16f else 0f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessLow
        )
    )

    val scale by animateFloatAsState(
        targetValue = if (isLongPressed) 1.05f else 1f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessLow
        )
    )

    val maxSwipeLeft = remember(density, swipeConfig?.maxSwipeWidthDp) {
        swipeConfig?.let { -with(density) { it.maxSwipeWidthDp.toPx() } } ?: 0f
    }
    val maxSwipeRight = 0f
    val clickDragTolerancePx = remember(density) { with(density) { 8.dp.toPx() } }

    val offsetXAnimatable = remember { Animatable(0f) }

    LaunchedEffect(maxSwipeLeft, maxSwipeRight) {
        offsetXAnimatable.updateBounds(maxSwipeLeft, maxSwipeRight)
        offsetXAnimatable.snapTo(0f)
    }

    val menuAlpha by remember(maxSwipeLeft) {
        derivedStateOf {
            val offset = offsetXAnimatable.value
            if (offset < 0f && maxSwipeLeft != 0f) {
                (abs(offset) / abs(maxSwipeLeft)).coerceIn(0f, 1f)
            } else 0f
        }
    }

    val showSwipeActions by remember {
        derivedStateOf { offsetXAnimatable.value < 0f }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(53.dp)
            .zIndex(if (isLongPressed) 10f else 0f)
            .onSizeChanged { size ->
                boxSize = size
            }
    ) {
        if (showSwipeActions && ownerActions != null) {
            val bookmark = ownerActions.bookmark
            Row(
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .padding(end = 18.dp)
                    .fillMaxHeight()
                    .graphicsLayer { alpha = menuAlpha },
                horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (swipeConfig != null && swipeConfig.showStarAction) {
                    // 加星按钮
                    Surface(
                        modifier = Modifier
                            .size(40.dp, 30.dp)
                            .fillMaxHeight(),
                        color = Color(0xFFFFB648),
                        shape = RoundedCornerShape(15.dp),
                        onClick = {
                            scope.launch {
                                offsetXAnimatable.animateTo(0f, animationSpec = tween(200))
                                viewModel.toggleStar(bookmark.id, bookmark.isStarred != 1)
                                firstPartyEvents.track("element_clicked", mapOf("element_id" to "bookmark_star_button", "screen_name" to "bookmarks"))
                                bookmarkListEvent
                                    .action("item_interact")
                                    .param("element", "star")
                                    .source("inbox")
                                    .send()
                            }
                        }
                    ) {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            Image(
                                painter = painterResource(if (bookmark.isStarred == 1) Res.drawable.ic_cell_action_starred else Res.drawable.ic_cell_action_star),
                                contentDescription = "bookmark_star".i18n(),
                                modifier = Modifier.size(20.dp),
                                contentScale = ContentScale.Fit
                            )
                        }
                    }
                }

                if (swipeConfig != null && swipeConfig.showArchiveAction) {
                    // 归档按钮
                    Surface(
                        modifier = Modifier
                            .size(40.dp, 30.dp)
                            .fillMaxHeight(),
                        color = Color(0xFF333333),
                        shape = RoundedCornerShape(15.dp),
                        onClick = {
                            scope.launch {
                                offsetXAnimatable.animateTo(0f, animationSpec = tween(200))
                                viewModel.toggleArchive(bookmark.id, bookmark.archiveStatus != 1)
                                firstPartyEvents.track("element_clicked", mapOf("element_id" to "bookmark_archive_button", "screen_name" to "bookmarks"))
                                bookmarkListEvent
                                    .action("item_interact")
                                    .param("element", "archive")
                                    .source("inbox")
                                    .send()
                            }
                        }
                    ) {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            Image(
                                painter = painterResource(if (bookmark.archiveStatus == 1) Res.drawable.ic_cell_action_archieved else Res.drawable.ic_cell_action_archieve),
                                contentDescription = "bookmark_archive".i18n(),
                                modifier = Modifier.size(20.dp),
                                contentScale = ContentScale.Fit
                            )
                        }
                    }
                }
            }
        }

        val swipeModifier = if (ownerActions != null) {
            Modifier.pointerInput(maxSwipeLeft, maxSwipeRight) {
                detectHorizontalDragGestures(
                    onDragStart = {
                        isDragging = true
                        totalDragDistance = 0f
                        dragStartOffset = offsetXAnimatable.value
                        scope.launch { offsetXAnimatable.stop() }
                    },
                    onDragEnd = {
                        val currentOffset = offsetXAnimatable.value
                        val isDraggingToClose = currentOffset > dragStartOffset
                        val threshold = if (isDraggingToClose) {
                            abs(maxSwipeLeft) * 0.8f
                        } else {
                            abs(maxSwipeLeft) * 0.4f
                        }
                        val shouldOpen = abs(currentOffset) >= threshold
                        scope.launch {
                            offsetXAnimatable.animateTo(
                                if (shouldOpen) maxSwipeLeft else 0f,
                                animationSpec = tween(200)
                            )
                            delay(50)
                            isDragging = false
                            totalDragDistance = 0f
                        }
                    },
                    onDragCancel = {
                        scope.launch {
                            offsetXAnimatable.animateTo(
                                targetValue = 0f,
                                animationSpec = tween(durationMillis = 200)
                            )
                            delay(50)
                            isDragging = false
                            totalDragDistance = 0f
                        }
                    },
                    onHorizontalDrag = { change, dragAmount ->
                        change.consume()
                        totalDragDistance += abs(dragAmount)
                        val newOffset = (offsetXAnimatable.value + dragAmount)
                            .coerceIn(maxSwipeLeft, maxSwipeRight)
                        scope.launch { offsetXAnimatable.snapTo(newOffset) }
                    }
                )
            }
        } else {
            Modifier
        }

        Surface(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    translationX = offsetXAnimatable.value
                    scaleX = scale
                    scaleY = scale
                    shadowElevation = elevation
                }
                .then(swipeModifier)
                .combinedClickable(
                    interactionSource = interactionSource,
                    indication = null,
                    enabled = !isDragging,
                    onClick = {
                        // 检查是否真的是点击而非滑动
                        if (totalDragDistance < clickDragTolerancePx) {
                            if (offsetXAnimatable.value != 0f) {
                                // 如果有滑动偏移,点击时关闭
                                scope.launch {
                                    offsetXAnimatable.animateTo(0f, animationSpec = tween(200))
                                }
                            } else {
                                if (ownerActions?.bookmark?.metadataStatus == "success") {
                                    firstPartyEvents.track("element_clicked", mapOf("element_id" to "bookmark_list_row", "screen_name" to "bookmarks"))
                                }
                                onClick()
                            }
                        }
                    },
                    onLongClick = if (ownerActions == null) null else {
                        {
                            if (!isDragging && totalDragDistance < clickDragTolerancePx) {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                isLongPressed = true
                                menuTriggerSource = MenuTriggerSource.LONG_PRESS
                            }
                        }
                    }
                ),
            color = Color(0xFFFCFCFC)
        ) {
            Box(modifier = Modifier.fillMaxSize()) {
                // 内容
                Row(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(start = 24.dp, end = 18.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        modifier = Modifier.weight(1f),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        ItemStatus(
                            item.downloadStatus,
                            swipeConfig?.sortType ?: BookmarkSortType.UPDATED,
                        )

                        Text(
                            text = item.displayTitle(),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                            style = TextStyle(fontSize = 16.sp, lineHeight = 24.sp, color = Color(0xFF0F1419))
                        )
                    }
                }

                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .drawBehind {
                            val overlay = if (isPressed) 0.05f else menuAlpha * 0.05f
                            if (overlay > 0f) {
                                drawRect(Color.Black.copy(alpha = overlay))
                            }
                            val flash = flashAlpha.value
                            if (flash > 0f) {
                                drawRect(Color.Black.copy(alpha = flash))
                            }
                        }
                )
            }
        }

        val cellHeight = 48.dp

        // 计算菜单位置偏移
        val menuOffset = remember(boxSize) {
            val boxWidthDp = with(density) { boxSize.width.toDp() }
            DpOffset(
                x = boxWidthDp - 180.dp - 8.dp,
                y = cellHeight - 10.dp
            )
        }

        if (showMenu && ownerActions != null) {
            val bookmark = ownerActions.bookmark
            Menu(
                expanded = showMenu,
                onDismissRequest = {
                    menuTriggerSource = MenuTriggerSource.NONE
                    isLongPressed = false
                },
                offset = menuOffset,
                modifier = Modifier.width(180.dp)
            ) {
                // 加星
                MenuItem(
                    icon = painterResource(if (bookmark.isStarred == 1) Res.drawable.ic_floating_panel_starred else Res.drawable.ic_cell_more_star),
                    text = (if (bookmark.isStarred == 1) "bookmark_unstar" else "bookmark_star").i18n(),
                    onClick = {
                        scope.launch {
                            menuTriggerSource = MenuTriggerSource.NONE
                            isLongPressed = false
                            viewModel.toggleStar(bookmark.id, bookmark.isStarred != 1)
                            firstPartyEvents.track("element_clicked", mapOf("element_id" to "bookmark_star_button", "screen_name" to "bookmarks"))
                        }
                    }
                )

                // 归档
                MenuItem(
                    icon = painterResource(if (bookmark.archiveStatus == 1) Res.drawable.ic_floating_panel_archieved else Res.drawable.ic_cell_more_archieve),
                    text = (if (bookmark.archiveStatus == 1) "bookmark_unarchive" else "bookmark_archive").i18n(),
                    onClick = {
                        scope.launch {
                            menuTriggerSource = MenuTriggerSource.NONE
                            isLongPressed = false
                            viewModel.toggleArchive(bookmark.id, bookmark.archiveStatus != 1)
                            firstPartyEvents.track("element_clicked", mapOf("element_id" to "bookmark_archive_button", "screen_name" to "bookmarks"))
                        }
                    }
                )

                // 修改标题
                MenuItem(
                    icon = painterResource(Res.drawable.ic_cell_more_edittitle),
                    text = "bookmark_edit_title".i18n(),
                    onClick = {
                        menuTriggerSource = MenuTriggerSource.NONE
                        isLongPressed = false
                        ownerActions.onEditTitle(bookmark)
                        firstPartyEvents.track("element_clicked", mapOf("element_id" to "bookmark_edit_title_button", "screen_name" to "bookmarks"))
                    }
                )

                // 删除
                MenuItem(
                    icon = painterResource(Res.drawable.ic_cell_more_delete),
                    text = "bookmark_delete".i18n(),
                    color = Color(0xFFF45454),
                    onClick = {
                        scope.launch {
                            menuTriggerSource = MenuTriggerSource.NONE
                            isLongPressed = false
                            viewModel.deleteBookmark(bookmark.id)
                            firstPartyEvents.track("element_clicked", mapOf("element_id" to "bookmark_delete_button", "screen_name" to "bookmarks"))
                        }
                    }
                )
            }
        }
    }
}
