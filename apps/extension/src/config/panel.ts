import aiImage from '~/assets/panel-item-ai.png'
import aiHighlightedImage from '~/assets/panel-item-ai-highlighted.png'
import aiSelectedImage from '~/assets/panel-item-ai-selected.png'
import aiSubImage from '~/assets/panel-item-ai-sub.png'
import archieveImage from '~/assets/panel-item-archieve.png'
import archieveHighlightedImage from '~/assets/panel-item-archieve-highlighted.png'
import archieveSelectedImage from '~/assets/panel-item-archieve-selected.png'
import chatbotImage from '~/assets/panel-item-chatbot.png'
import chatbotHighlightedImage from '~/assets/panel-item-chatbot-highlighted.png'
import chatbotSelectedImage from '~/assets/panel-item-chatbot-selected.png'
import chatbotSubImage from '~/assets/panel-item-chatbot-sub.png'
import commentsImage from '~/assets/panel-item-comments.png'
import commentsHighlightedImage from '~/assets/panel-item-comments-highlighted.png'
import commentsSelectedImage from '~/assets/panel-item-comments-selected.png'
import commentsSubImage from '~/assets/panel-item-comments-sub.png'
import feedbackImage from '~/assets/panel-item-feedback.png'
import feedbackHighlightedImage from '~/assets/panel-item-feedback-highlighted.png'
import feedbackSubImage from '~/assets/panel-item-feedback-sub.png'
import feedbackSubHighlightedImage from '~/assets/panel-item-feedback-sub-highlighted.png'
import outlineImage from '~/assets/panel-item-outline.png'
import outlineHighlightedImage from '~/assets/panel-item-outline-highlighted.png'
import outlineSelectedImage from '~/assets/panel-item-outline-selected.png'
import outlineSubImage from '~/assets/panel-item-outline-sub.png'
import shareImage from '~/assets/panel-item-share.png'
import shareHighlightedImage from '~/assets/panel-item-share-highlighted.png'
import starImage from '~/assets/panel-item-star.png'
import starHighlightedImage from '~/assets/panel-item-star-highlighted.png'
import starSelectedImage from '~/assets/panel-item-star-selected.png'

export enum PanelItemType {
  AI = 'ai',
  Outline = 'outline',
  Chat = 'chat',
  Share = 'share',
  Comments = 'comments',
  Archieve = 'archieve',
  Star = 'star',
  Feedback = 'feedback'
}

export interface PanelItem {
  type: PanelItemType
  icon: string
  highlighedIcon: string
  selectedIcon?: string
  title?: string | ComputedRef<string>
  hovered: boolean
  selectedColor?: string
  isSelected?: () => boolean
  isLoading?: boolean
  finishHandler?: () => void
}

interface ImageInfo {
  main: string
  sub: string
  highlighted: string
  selected: string
  subHighlighted: string
}

export const Images: Record<'ai' | 'outline' | 'chatbot' | 'comments' | 'star' | 'archieve' | 'share' | 'feedback', ImageInfo> = {
  ai: {
    main: aiImage,
    sub: aiSubImage,
    highlighted: aiHighlightedImage,
    selected: aiSelectedImage,
    subHighlighted: aiHighlightedImage
  },
  outline: {
    main: outlineImage,
    sub: outlineSubImage,
    highlighted: outlineHighlightedImage,
    selected: outlineSelectedImage,
    subHighlighted: outlineHighlightedImage
  },
  chatbot: {
    main: chatbotImage,
    sub: chatbotSubImage,
    highlighted: chatbotHighlightedImage,
    selected: chatbotSelectedImage,
    subHighlighted: chatbotHighlightedImage
  },
  comments: {
    main: commentsImage,
    sub: commentsSubImage,
    highlighted: commentsHighlightedImage,
    selected: commentsSelectedImage,
    subHighlighted: commentsHighlightedImage
  },
  star: {
    main: starImage,
    sub: starImage,
    highlighted: starHighlightedImage,
    selected: starSelectedImage,
    subHighlighted: starHighlightedImage
  },
  archieve: {
    main: archieveImage,
    sub: archieveImage,
    highlighted: archieveHighlightedImage,
    selected: archieveSelectedImage,
    subHighlighted: archieveHighlightedImage
  },
  share: {
    main: shareImage,
    sub: shareImage,
    highlighted: shareHighlightedImage,
    selected: shareImage,
    subHighlighted: shareHighlightedImage
  },
  feedback: {
    main: feedbackImage,
    sub: feedbackSubImage,
    highlighted: feedbackHighlightedImage,
    selected: feedbackHighlightedImage,
    subHighlighted: feedbackSubHighlightedImage
  }
}
