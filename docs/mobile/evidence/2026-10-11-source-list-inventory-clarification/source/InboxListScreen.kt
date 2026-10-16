package com.slax.reader.ui.inbox

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavController
import com.slax.reader.const.BookmarkRoutes
import com.slax.reader.const.SettingsRoutes
import com.slax.reader.ui.rss.RssFeedSwitcher
import com.slax.reader.ui.rss.RssPanel
import com.slax.reader.ui.rss.RssViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import com.slax.reader.const.component.EditNameDialog
import com.slax.reader.data.database.model.BookmarkSortType
import com.slax.reader.data.database.model.InboxListBookmarkItem
import com.slax.reader.ui.inbox.compenents.*
import com.slax.reader.ui.sidebar.Sidebar
import com.slax.reader.utils.i18n
import com.slax.reader.utils.FirstPartyEventReporter
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.painterResource
import org.koin.compose.koinInject
import org.koin.compose.viewmodel.koinViewModel
import slax_reader_client.composeapp.generated.resources.Res
import slax_reader_client.composeapp.generated.resources.ic_inbox_tab
import slax_reader_client.composeapp.generated.resources.ic_xs_inbox_add
import slax_reader_client.composeapp.generated.resources.inbox_more

@Composable
fun InboxListScreen(
    navCtrl: NavController,
    viewModel: InboxListViewModel? = null,
    sidebarViewModel: com.slax.reader.ui.sidebar.SidebarViewModel? = null,
) {
    val inboxViewModel = viewModel ?: koinViewModel<InboxListViewModel>()
    val rssModel: RssViewModel = koinViewModel()
    val rssState by rssModel.state.collectAsState()
    val collections by inboxViewModel.subscribedCollections.collectAsState()
    val activeCollectionId by inboxViewModel.activeCollectionId.collectAsState()
    val userInfo by inboxViewModel.userInfo.collectAsState()
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(owner, rssModel) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            rssModel.load()
            while (true) { delay(5_000); rssModel.poll() }
        }
    }
    val firstPartyEvents: FirstPartyEventReporter = koinInject()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()

    var rssSelected by rememberSaveable { mutableStateOf(false) }
    var addingRss by rememberSaveable { mutableStateOf(false) }
    val feedStates = rememberSaveableStateHolder()
    var showAddLinkDialog by remember { mutableStateOf(false) }
    var editingBookmark by remember { mutableStateOf<InboxListBookmarkItem?>(null) }
    val currentSortType by inboxViewModel.sortType.collectAsState()
    val activeCollection by inboxViewModel.activeCollection.collectAsState()

    LaunchedEffect(currentSortType) {
        val listMode = when (currentSortType) {
            BookmarkSortType.UPDATED -> "inbox"
            BookmarkSortType.STARRED -> "starred"
            BookmarkSortType.ARCHIVED -> "archive"
        }
        firstPartyEvents.track(
            "screen_viewed",
            mapOf("screen_name" to "bookmarks", "list_mode" to listMode)
        )
    }

    Sidebar(
        drawerState = drawerState,
        navCtrl = navCtrl,
        viewModel = sidebarViewModel,
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFFF5F5F3))
        ) {
            Column(
                modifier = Modifier.fillMaxSize()
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                ) {
                    Box(
                        modifier = Modifier.statusBarsPadding()
                    ) {
                        NavigationBar(
                            onAvatarClick = {
                                firstPartyEvents.track("element_clicked", mapOf("element_id" to "sidebar_open_button", "screen_name" to "bookmarks"))
                                scope.launch {
                                    drawerState.open()
                                }
                            },
                            onAddLinkClick = {
                                firstPartyEvents.track("element_clicked", mapOf("element_id" to "bookmark_add_button", "screen_name" to "bookmarks"))
                                if (rssSelected) addingRss = true else showAddLinkDialog = true
                            },
                            currentSortType = currentSortType,
                            rssSelected = rssSelected,
                            showRss = rssState.enabled,
                            onRssSelected = {
                                firstPartyEvents.track("element_clicked", mapOf("element_id" to "inbox_rss_control", "screen_name" to "bookmarks"))
                                rssSelected = true
                            },
                            onSortTypeChanged = { type ->
                                firstPartyEvents.track("element_clicked", mapOf("element_id" to "inbox_sort_control", "screen_name" to "bookmarks"))
                                rssSelected = false
                                inboxViewModel.setSortType(type)
                            }
                        )
                    }

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 10.dp)
                            .clickable(
                                indication = null,
                                interactionSource = remember { MutableInteractionSource() }
                            ) {
                                inboxViewModel.scrollToTop()
                            }
                    )
                }

                if (rssSelected && rssState.enabled) {
                    RssFeedSwitcher(
                        subscriptions = rssState.subscriptions,
                        selectedId = rssState.selected,
                        onSelect = { id ->
                            if (!rssState.busy) rssModel.select(id)
                        },
                        onAdd = { addingRss = true },
                    )
                } else {
                    CollectionFeedSwitcher(
                        ownAvatar = userInfo?.picture.orEmpty(), collections = collections,
                        inboxActive = activeCollectionId == null,
                        activeCollectionId = activeCollectionId,
                        onSelect = { id -> inboxViewModel.selectCollection(id) },
                    )
                }
                Box(Modifier.weight(1f)) {
                    feedStates.SaveableStateProvider(if (rssSelected) "rss" else "inbox") {
                        if (rssSelected) {
                            RssPanel(
                                model = rssModel,
                                adding = addingRss,
                                onDismissAdd = { addingRss = false },
                                onRequestAdd = { addingRss = true },
                                onOpenSettings = { navCtrl.navigate(SettingsRoutes) },
                                onOpenEntry = { entry -> navCtrl.navigate(BookmarkRoutes(bookmarkId = "", rssEntryId = entry.id, openedFrom = "rss")) },
                            )
                        } else {
                            ContentSection(
                                navCtrl = navCtrl,
                                inboxViewModel = inboxViewModel,
                                onEditTitle = { editingBookmark = it },
                            )
                        }
                    }
                }
            }
        }
    }

    if (showAddLinkDialog) {
        AddLinkDialog(
            inboxView = inboxViewModel,
            onDismissRequest = {
                showAddLinkDialog = false
            }
        )
    }

    ProcessingDialog(
        inboxView = inboxViewModel,
    )

    if (editingBookmark != null) {
        EditNameDialog(
            initialTitle = editingBookmark!!.displayTitle(),
            onConfirm = { title ->
                inboxViewModel.viewModelScope.launch {
                    inboxViewModel.confirmEditTitle(editingBookmark!!.id, title)
                }
            },
            onDismissRequest = {
                editingBookmark = null
            }
        )
    }
}


@Composable
private fun NavigationBar(
    onAvatarClick: () -> Unit = {},
    onAddLinkClick: () -> Unit = {},
    currentSortType: BookmarkSortType = BookmarkSortType.UPDATED,
    rssSelected: Boolean = false,
    showRss: Boolean = false,
    onRssSelected: () -> Unit = {},
    onSortTypeChanged: (BookmarkSortType) -> Unit = {}
) {
    val tabInteractionSource = remember { MutableInteractionSource() }
    val isTabPressed by tabInteractionSource.collectIsPressedAsState()

    val addInteractionSource = remember { MutableInteractionSource() }
    val isAddPressed by addInteractionSource.collectIsPressedAsState()

    val titleInteractionSource = remember { MutableInteractionSource() }
    val isTitlePressed by titleInteractionSource.collectIsPressedAsState()

    var expanded by remember { mutableStateOf(false) }

    val density = LocalDensity.current
    var navBarHeightPx by remember { mutableStateOf(0) }
    val menuYOffset = with(density) { navBarHeightPx.toDp() } + 8.dp

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .onGloballyPositioned { navBarHeightPx = it.size.height }
    ) {
        Row(
            modifier = Modifier
                .align(Alignment.CenterStart)
                .alpha(if (isTabPressed) 0.5f else 1f)
                .clickable(
                    interactionSource = tabInteractionSource,
                    indication = null
                ) {
                    onAvatarClick()
                },
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {

            Image(
                painter = painterResource(Res.drawable.ic_inbox_tab),
                contentDescription = "Menu",
                modifier = Modifier.padding(start = 24.dp).padding(vertical = 10.dp).size(24.dp, 24.dp),
                contentScale = ContentScale.Fit
            )

            UserAvatar()
        }

        Box(
            modifier = Modifier.align(Alignment.Center)
        ) {
            Row(
                modifier = Modifier
                    .padding(vertical = 5.dp, horizontal = 20.dp)
                    .alpha(if (isTitlePressed) 0.5f else 1f)
                    .clickable(
                        interactionSource = titleInteractionSource,
                        indication = null
                    ) {
                        expanded = true
                    },
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = if (rssSelected) "rss_feeds".i18n() else currentSortType.labelKey().i18n(),
                    style = TextStyle(
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Medium,
                        lineHeight = 24.sp,
                        color = Color(0xFF0F1419),
                        textAlign = TextAlign.Center,
                    )
                )

                Image(
                    painter = painterResource(Res.drawable.inbox_more),
                    contentDescription = "Switch List",
                    modifier = Modifier.size(10.dp),
                    contentScale = ContentScale.Fit
                )
            }
        }

        InboxDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            yOffset = menuYOffset
        ) {
            BookmarkSortType.entries.forEach { type ->
                InboxMenuTextItem(
                    text = type.labelKey().i18n(),
                    selected = !rssSelected && type == currentSortType,
                    onClick = {
                        onSortTypeChanged(type)
                        expanded = false
                    }
                )

            }
            if (showRss) {
                InboxMenuTextItem(
                    text = "rss_feeds".i18n(),
                    selected = rssSelected,
                    onClick = {
                        onRssSelected()
                        expanded = false
                    }
                )
            }
        }

        Box(
            modifier = Modifier.align(Alignment.CenterEnd)
                .alpha(if (isAddPressed) 0.5f else 1f)
                .clickable(
                    interactionSource = addInteractionSource,
                    indication = null
                ) {
                    onAddLinkClick()
                }
        ) {
            Image(
                painter = painterResource(Res.drawable.ic_xs_inbox_add),
                contentDescription = "Add Link",
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 10.dp)
                    .size(24.dp, 24.dp),
                contentScale = ContentScale.Fit
            )
        }
    }
}

@Composable
private fun ContentSection(
    navCtrl: NavController,
    inboxViewModel: InboxListViewModel,
    onEditTitle: (bookmark: InboxListBookmarkItem) -> Unit = { _ -> }
) {

    val collections by inboxViewModel.subscribedCollections.collectAsState()
    val activeCollectionId by inboxViewModel.activeCollectionId.collectAsState()
    val activeCollection by inboxViewModel.activeCollection.collectAsState()
    val collectionBookmarks by inboxViewModel.collectionBookmarks.collectAsState()
    val userInfo by inboxViewModel.userInfo.collectAsState()


    Box(
        modifier = Modifier
            .fillMaxSize()
            .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    color = Color(0xFFFCFCFC),
                    shape = if (collections.isEmpty()) {
                        RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)
                    } else {
                        RectangleShape
                    }
                )
        ) {
            if (activeCollectionId == null) {
                ArticleList(
                    navCtrl = navCtrl,
                    viewModel = inboxViewModel,
                    onEditTitle = onEditTitle,
                )
            } else {
                CollectionFeedContent(
                    navCtrl = navCtrl,
                    viewModel = inboxViewModel,
                    collection = activeCollection,
                    bookmarks = collectionBookmarks,
                )
            }
        }

        if (activeCollectionId == null) {
            ContinueReading(
                onClick = { bookmark ->
                    navCtrl.navigate(
                        BookmarkRoutes(
                            bookmarkId = bookmark.bookmarkId,
                            openedFrom = "bookmarks",
                            collectionOwnerId = bookmark.collectionOwnerId,
                            collectionId = bookmark.collectionId,
                        )
                    )
                },
                modifier = Modifier.align(Alignment.BottomCenter)
            )
        }
    }
}
