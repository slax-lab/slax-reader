package com.slax.reader.ui.bookmark.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.slax.reader.ui.bookmark.BookmarkDetailViewModel
import com.slax.reader.utils.OpenInBrowser
import com.slax.reader.utils.bookmarkEvent
import com.slax.reader.utils.collapseWhitespace
import com.slax.reader.utils.i18n
import org.koin.compose.viewmodel.koinViewModel

@Composable
fun HeaderContent(
    onHeightChanged: (Float) -> Unit,
    rssPreview: com.slax.reader.ui.bookmark.RssReaderState? = null,
) {
    if (rssPreview != null) {
        com.slax.reader.ui.bookmark.RssReaderHeader(rssPreview, onHeightChanged)
        return
    }
    println("[watch][UI] recomposition HeaderContent")

    val viewModel = koinViewModel<BookmarkDetailViewModel>()
    val detailState by viewModel.bookmarkDelegate.bookmarkDetailState.collectAsState()

    var externalUrl by remember { mutableStateOf<String?>(null) }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .onGloballyPositioned { coordinates ->
                val newHeight = coordinates.size.height.toFloat()
                onHeightChanged(newHeight)
            }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp)
        ) {
            Spacer(modifier = Modifier.height(44.dp))

            // 对齐 dweb：折叠换行、最多 3 行
            Text(
                text = detailState.displayTitle.collapseWhitespace(),
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                style = TextStyle(
                    fontSize = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                    lineHeight = 30.sp,
                    color = Color(0xFF0f1419)
                )
            )

            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = detailState.displayTime,
                    style = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, color = Color(0xFF999999))
                )
                Text(
                    "detail_view_original".i18n(),
                    modifier = Modifier.padding(start = 16.dp).clickable {
                        externalUrl = detailState.metadataUrl
                        bookmarkEvent.view("original").send()
                    },
                    style = TextStyle(color = Color(0xFF5490C2), fontSize = 14.sp, lineHeight = 20.sp)
                )
            }

            TagsView(modifier = Modifier.padding(top = 16.dp))

            OverviewView(modifier = Modifier.padding(top = 20.dp))
        }
    }

    if (externalUrl != null) {
        OpenInBrowser(externalUrl!!)
        externalUrl = null
    }
}
