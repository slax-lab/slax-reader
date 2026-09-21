import { defineCustomElement } from 'vue'

import PhotoSwiperDots from './PhotoSwiperDots.ce.vue'
import SocialPostFooterInfo from './social-post/SocialPostFooterInfo.ce.vue'
import SocialPostUserInfo from './social-post/SocialPostUserInfo.ce.vue'
import TweetFooterInfo from './tweet/TweetFooterInfo.ce.vue'
import TweetUserInfo from './tweet/TweetUserInfo.ce.vue'
import UnsupportedVideo from './UnsupportedVideo.ce.vue'
import WechatVideoInfo from './WechatVideoInfo.ce.vue'
import YoutubePlayer from './youtube/YoutubePlayer.ce.vue'

import { isClient } from '@commons/utils/is'

/**
 * 注册自定义组件方法，用于在客户端环境下注册自定义组件
 * 注意：
 * 1：此方法需要在使用自定义组件前调用，否则无法使用自定义组件，建议在onMounted入口中调用
 * 2：在服务端环境下，不要调用此方法
 */
export const registerComponents = () => {
  if (!isClient) {
    return
  }

  const refs = {
    'wechat-video-info': WechatVideoInfoElement,
    'unsupported-video': UnsupportedVideoElement,
    'photo-swiper-dots': PhotoSwiperDotsElement,
    'tweet-user-info': TweetUserInfoElement,
    'twwet-footer-info': TweetFooterInfoElement,
    'social-post-user-info': SocialPostUserInfoElement,
    'social-post-footer-info': SocialPostFooterInfoElement,
    'youtube-player-view': YoutubePlayerElement
  }

  Object.entries(refs).forEach(([key, value]) => {
    if (!customElements.get(key)) {
      customElements.define(key, value)
    }
  })
}

/**
 * 对外提供的自定义组件
 */

export const WechatVideoInfoElement = defineCustomElement(WechatVideoInfo)
export const UnsupportedVideoElement = defineCustomElement(UnsupportedVideo)
export const PhotoSwiperDotsElement = defineCustomElement(PhotoSwiperDots)
export const TweetUserInfoElement = defineCustomElement(TweetUserInfo)
export const TweetFooterInfoElement = defineCustomElement(TweetFooterInfo)
export const SocialPostUserInfoElement = defineCustomElement(SocialPostUserInfo)
export const SocialPostFooterInfoElement = defineCustomElement(SocialPostFooterInfo)
export const YoutubePlayerElement = defineCustomElement(YoutubePlayer)
