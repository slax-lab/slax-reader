export interface TikHubWeiboStatusData {
  visible: {
    type: number
    list_id: number
  }
  created_at: string
  id: string
  mid: string
  can_edit: boolean
  text: string
  textLength: number
  source: string
  favorited: boolean
  // 无图帖子（纯文字/纯视频）TikHub 不返回此字段，运行时可能为 undefined
  pic_ids?: string[]
  pic_focus_point: Array<{
    focus_point: {
      left: number
      top: number
      width: number
      height: number
    }
    pic_id: string
  }>
  thumbnail_pic: string
  bmiddle_pic: string
  original_pic: string
  is_paid: boolean
  mblog_vip_type: number
  user: {
    id: number
    screen_name: string
    profile_image_url: string
    profile_url: string
    close_blue_v: boolean
    description: string
    follow_me: boolean
    following: boolean
    follow_count: number
    followers_count: string
    cover_image_phone: string
    avatar_hd: string
    badge: any
    statuses_count: number
    verified: boolean
    verified_type: number
    gender: string
    mbtype: number
    svip: number
    urank: number
    mbrank: number
    followers_count_str: string
    verified_type_ext: number
    verified_reason: string
    like: boolean
    like_me: boolean
    special_follow: boolean
    user_token: string
  }
  reposts_count: number
  comments_count: number
  reprint_cmt_count: number
  attitudes_count: number
  mixed_count: number
  pending_approval_count: number
  isLongText: boolean
  show_mlevel: number
  mix_media_ids: string[]
  darwin_tags: any[]
  ad_marked: boolean
  mblogtype: number
  item_category: string
  rid: string
  number_display_strategy: {
    apply_scenario_flag: number
    display_text_min_number: number
    display_text: string
  }
  comment_guide_ext: string
  content_auth: number
  is_show_mixed: boolean
  safe_tags: number
  comment_manage_info: {
    comment_permission_type: number
    approval_comment_type: number
    comment_sort_type: number
  }
  pic_num: number
  fid: number
  mlevel: number
  region_name: string
  region_opt: number
  detail_bottom_bar: number
  is_all_video: boolean
  page_info?: {
    type: string
    object_type: number
    url_ori: string
    page_pic: {
      width: string
      pid: string
      source: string
      is_self_cover: string
      type: string
      url: string
      height: string
    }
    page_url: string
    object_id: string
    page_title: string
    title: string
    content1: string
    content2: string
    video_orientation: string
    play_count: string
    media_info: {
      stream_url: string
      stream_url_hd: string
      duration: number
    }
    urls: {
      mp4_720p_mp4: string
      mp4_ld_mp4: string
      mp4_hd_mp4: string
    }
  }
  /**
   * 实测确认（2026-07-05，真实 token）：TikHub web_v2 接口不返回 pics 数组，
   * 图片/视频媒体信息在 mix_media_info.items[] 中；type="pic" 的 item.data 字段
   * 已经是与 WeiboData.pic_infos[pid] 完全一致的结构（thumbnail/bmiddle/large/original/largest/mw2000/largecover/...）。
   */
  mix_media_info?: {
    items: Array<{
      type: 'pic' | 'video' | string
      id: string
      data: any
    }>
  }
  bid: string
  buttons: Array<{
    type: string
    name: string
    sub_type: number
    params: {
      uid: number
    }
  }>
  status_title: string
  ok: number
}

export interface TikHubWeiboResponse {
  code: number
  message: string
  message_zh?: string
  data: TikHubWeiboStatusData | null
}

export interface WeiboData {
  visible: Visible
  created_at: string
  id: number
  idstr: string
  mid: string
  mblogid: string
  user: User
  can_edit: boolean
  textLength: number
  annotations: Annotation[]
  source: string
  favorited: boolean
  rid: string
  pic_ids: string[]
  pic_num: number
  pic_infos: PicInfos
  is_paid: boolean
  mblog_vip_type: number
  number_display_strategy: NumberDisplayStrategy
  reposts_count: number
  comments_count: number
  attitudes_count: number
  attitudes_status: number
  continue_tag: ContinueTag
  isLongText: boolean
  longText: LongText
  mlevel: number
  content_auth: number
  is_show_bulletin: number
  comment_manage_info: CommentManageInfo
  share_repost_type: number
  topic_struct: TopicStruct2[]
  title: Title
  mblogtype: number
  showFeedRepost: boolean
  showFeedComment: boolean
  pictureViewerSign: boolean
  showPictureViewer: boolean
  rcList: any[]
  analysis_extra: string
  readtimetype: string
  mixed_count: number
  is_show_mixed: boolean
  mblog_feed_back_menus_format: any[]
  isSinglePayAudio: boolean
  text: string
  text_raw: string
  ok: number
}

export interface Visible {
  type: number
  list_id: number
}

export interface User {
  id: number
  idstr: string
  pc_new: number
  screen_name: string
  profile_image_url: string
  profile_url: string
  verified: boolean
  verified_type: number
  domain: string
  weihao: string
  verified_type_ext: number
  avatar_large: string
  avatar_hd: string
  follow_me: boolean
  following: boolean
  mbrank: number
  mbtype: number
  v_plus: number
  user_ability: number
  planet_video: boolean
  icon_list: IconList[]
}

export interface IconList {
  type: string
  data: Data2
}

export interface Data2 {
  mbrank?: number
  mbtype?: number
  svip?: number
  vvip?: number
  value?: string
  icon_img?: string
  title?: string
  url?: string
}

export interface Annotation {
  uid: string
  with_video: boolean
  item_id: string
  time: number
  type: string
}

export interface PicInfos {
  '61ecce97ly1gh9wdjiomgj20nm2o5u0x': N61ecce97ly1gh9wdjiomgj20nm2o5u0x
}

export interface N61ecce97ly1gh9wdjiomgj20nm2o5u0x {
  thumbnail: Thumbnail
  bmiddle: Bmiddle
  large: Large
  original: Original
  largest: Largest
  mw2000: Mw2000
  largecover: Largecover
  object_id: string
  pic_id: string
  photo_tag: number
  type: string
  pic_status: number
}

export interface Thumbnail {
  url: string
  width: number
  height: number
  cut_type: number
  type: any
}

export interface Bmiddle {
  url: string
  width: number
  height: number
  cut_type: number
  type: any
}

export interface Large {
  url: string
  width: number
  height: number
  cut_type: number
  type: any
}

export interface Original {
  url: string
  width: number
  height: number
  cut_type: number
  type: any
}

export interface Largest {
  url: string
  width: number
  height: number
  cut_type: number
  type: any
}

export interface Mw2000 {
  url: string
  width: number
  height: number
  cut_type: number
  type: any
}

export interface Largecover {
  url: string
  width: number
  height: number
  cut_type: number
  type: any
}

export interface NumberDisplayStrategy {
  apply_scenario_flag: number
  display_text_min_number: number
  display_text: string
}

export interface ContinueTag {
  title: string
  pic: string
  scheme: string
}

export interface LongText {
  created_at: string
  appid: number
  pic_ids: string[]
  annotations: Annotation2[]
  mblog_vip_type: number
  user: User2
  pic_infos: PicInfos2
  weibo_position: number
  show_attitude_bar: number
  topic_struct: TopicStruct[]
  content: string
}

export interface Annotation2 {
  uid: string
  with_video: boolean
  item_id: string
  time: number
  type: string
}

export interface User2 {
  id: number
  idstr: string
  class: number
  screen_name: string
  name: string
  province: string
  city: string
  location: string
  description: string
  url: string
  profile_image_url: string
  light_ring: boolean
  cover_image_phone: string
  profile_url: string
  domain: string
  weihao: string
  gender: string
  followers_count: number
  followers_count_str: string
  friends_count: number
  pagefriends_count: number
  statuses_count: number
  video_status_count: number
  video_play_count: number
  super_topic_not_syn_count: number
  favourites_count: number
  created_at: string
  following: boolean
  allow_all_act_msg: boolean
  geo_enabled: boolean
  verified: boolean
  verified_type: number
  remark: string
  insecurity: Insecurity
  ptype: number
  allow_all_comment: boolean
  avatar_large: string
  avatar_hd: string
  verified_reason: string
  verified_trade: string
  verified_reason_url: string
  verified_source: string
  verified_source_url: string
  verified_state: number
  verified_level: number
  verified_type_ext: number
  pay_remind: number
  pay_date: string
  has_service_tel: boolean
  verified_reason_modified: string
  verified_contact_name: string
  verified_contact_email: string
  verified_contact_mobile: string
  follow_me: boolean
  like: boolean
  like_me: boolean
  online_status: number
  bi_followers_count: number
  lang: string
  star: number
  mbtype: number
  mbrank: number
  svip: number
  vvip: number
  mb_expire_time: number
  block_word: number
  block_app: number
  level: number
  type: number
  ulevel: number
  user_limit: number
  badge: Badge
  badge_top: string
  has_ability_tag: number
  extend: Extend
  chaohua_ability: number
  brand_ability: number
  nft_ability: number
  vplus_ability: number
  wenda_ability: number
  live_ability: number
  gongyi_ability: number
  paycolumn_ability: number
  newbrand_ability: number
  ecommerce_ability: number
  hardfan_ability: number
  wbcolumn_ability: number
  interaction_user: number
  audio_ability: number
  place_ability: number
  credit_score: number
  user_ability: number
  urank: number
  story_read_state: number
  vclub_member: number
  is_teenager: number
  is_guardian: number
  is_teenager_list: number
  pc_new: number
  special_follow: boolean
  planet_video: number
  video_mark: number
  live_status: number
  user_ability_extend: number
  brand_account: number
  hongbaofei: number
  tab_manage: string
  reward_status: number
  green_mode: number
  urisk: number
  unfollowing_recom_switch: number
  avatar_type: number
  skin_profile_element: string
  skin_cover_poster: string
  skin_cover_image: string
  is_big: number
  auth_status: number
  auth_realname: any
  auth_career: any
  auth_career_name: any
  show_auth: number
  is_auth: number
  is_punish: number
  avatar_hd_pid: string
  like_display: number
  comment_display: number
}

export interface Insecurity {
  sexual_content: boolean
}

export interface Badge {
  uc_domain: number
  enterprise: number
  anniversary: number
  taobao: number
  gongyi: number
  gongyi_level: number
  bind_taobao: number
  dailv: number
  zongyiji: number
  vip_activity1: number
  unread_pool: number
  daiyan: number
  vip_activity2: number
  fools_day_2016: number
  uefa_euro_2016: number
  unread_pool_ext: number
  self_media: number
  dzwbqlx_2016: number
  discount_2016: number
  follow_whitelist_video: number
  league_badge: number
  lol_msi_2017: number
  super_star_2017: number
  video_attention: number
  travel_2017: number
  lol_gm_2017: number
  cz_wed_2017: number
  inspector: number
  panda: number
  uve_icon: number
  user_name_certificate: number
  suishoupai_2018: number
  wenda: number
  wenchuan_10th: number
  super_star_2018: number
  worldcup_2018: number
  wenda_v2: number
  league_badge_2018: number
  dailv_2018: number
  asiad_2018: number
  qixi_2018: number
  yiqijuan_2018: number
  meilizhongguo_2018: number
  lol_s8: number
  kpl_2018: number
  national_day_2018: number
  double11_2018: number
  weibo_display_fans: number
  relation_display: number
  wbzy_2018: number
  memorial_2018: number
  v_influence_2018: number
  hongbaofei_2019: number
  status_visible: number
  denglong_2019: number
  fu_2019: number
  womensday_2018: number
  avengers_2019: number
  suishoupai_2019: number
  wusi_2019: number
  earth_2019: number
  hongrenjie_2019: number
  dailv_2019: number
  china_2019: number
  hongkong_2019: number
  jvhuasuan_2019: number
  taohuayuan_2019: number
  dzwbqlx_2019: number
  rrgyj_2019: number
  cishan_2019: number
  family_2019: number
  shouhuan_2019: number
  ant_2019: number
  weishi_2019: number
  shuang11_2019: number
  kdx_2019: number
  wbzy_2019: number
  starlight_2019: number
  daqi_2019: number
  gongjiri_2019: number
  macao_2019: number
  china_2019_2: number
  hongbao_2020: number
  feiyan_2020: number
  hope_2020: number
  kangyi_2020: number
  daka_2020: number
  green_2020: number
  graduation_2020: number
  pc_new: number
  kfc_2020: number
  dailv_2020: number
  movie_2020: number
  mi_2020: number
  vpick_2020: number
  cddyh_2020: number
  nike_2020: number
  school_2020: number
  gongyi_2020: number
  hongrenjie_2020: number
  test_icon: number
  china_2020: number
  nissan_2020: number
  zjszgf_2020: number
  zaolang_2020: number
  aizi_2020: number
  wennuanji_2020: number
  weibozhiye_2020: number
  yijia7_2020: number
  kfcflag_2021: number
  hongbaofeifuniu_2021: number
  cuccidlam20_2021: number
  cuccidlam12_2021: number
  cuccidlam25_2021: number
  hongbaofeijika_2021: number
  shequweiyuan_2021: number
  weibozhiyexianxia_2021: number
  zhongcaoguan_2021: number
  nihaoshenghuojie_2021: number
  lvzhilingyang_2021: number
  xiaominewlogo_2021: number
  disney5_2021: number
  earthguarder_2021: number
  yuanlongping_2021: number
  ylpshuidao_2021: number
  brand_account_2021: number
  gaokao_2021: number
  ouzhoubei_2021: number
  biyeji_2021: number
  party_cardid_state: number
  hongrenjie_2021: number
  aoyun_2021: number
  zhongcaouser_2021: number
  dailu_2021: number
  companion_card: number
  fishfarm_2021: number
  kaixue21_2021: number
  zhonghuacishanri_2021: number
  renrengongyijie_2021: number
  yinyuejie21_2021: number
  qianbaofu_2021: number
  yingxionglianmengs11_2021: number
  yxlmlpl_2021: number
  hongbaofei_2022: number
  qichenqiche_2021: number
  weibozhiye_2021: number
  weibozhiyebobao_2021: number
  social_content: number
  hongbaofei2022_2021: number
  dongaohui_2022: number
  pc_experiment: number
  youyic_2022: number
  newdongaohui_2022: number
  bddxrrdongaohui_2022: number
  lvzhilingyang_2022: number
  wenmingxiaobiaobing_2022: number
  nihaochuntian_2022: number
  video_visible: number
  ceshiicon_2022: number
  zuimeilaodongjie_2022: number
  iplocationchange_2022: number
  biyeji_2022: number
  shuidao_2022: number
  mengniu_2022: number
  is_university: number
  city_university: number
  gaokao_2022: number
  quanminjianshen_2022: number
  hangmu_2022: number
  guoqi_2022: number
  gangqi_2022: number
  dailv_2022: number
  dailvmingxing_2022: number
  comment_source: number
  huoban_2022: number
  zhongqiujie_2022: number
  kaixueji_2022: number
  renrengongyijie_2022: number
  guoqing_2022: number
  guoq_2022: number
  s12_2022: number
  clock_in_ug: number
  hongrenjie_2022: number
  pijingzhanji_2022: number
  guangpanxingdong_2022: number
  shijiebei_2022: number
  hongrenjienew_2022: number
  shijiebeigolden_2022: number
  baokemeng_2022: number
  moyudaka_2022: number
  jiancjiyundong_2022: number
  zhuijudaka_2022: number
  shenyeshudongdaka_2022: number
  suishoupaidaka_2022: number
  meirimengchongdaka_2022: number
  meirizaoqidaka_2022: number
  meiriyicandaka_2022: number
  ranghongbaofei_2023: number
  pinganguo_2022: number
  yuanshen_2023: number
  chunjiesheyingdasai_2023: number
  tuniandiyitiaoweibo_2023: number
  xinyuncao_2023: number
  taohua_2023: number
  shangyeceshi1: number
  shangyeceshi2: number
  shangyeceshi3: number
  shuimianri_2023: number
  diqiuyixiaoshi_2023: number
  star_crown: number
  guangyuyexing_2023: number
  yaya_panda: number
  weixiaori_2023: number
  muqinjie_2023: number
  dumei_2022: number
  biyeji_2023: number
  gaokao_2023: number
  duanwujie_2023: number
  xuexidaka_2023: number
  haowufenxiangdaka_2023: number
  zhuifandaka_2023: number
  nvzu_2023: number
  guangyuye_2023: number
  tfboy_2023: number
  weilandangan_2023: number
  qixi_2023: number
  guangyuyezhilian_2023: number
  renrengongyijie_2023: number
  kaixueji_2023: number
  yayunhui_2023: number
  yayunhui_dianjing: number
  laoshiyeyeni_2023: number
  yayunhuiguoqi_2023: number
  guangmingyueman_2023: number
  s13_2023: number
  wangzherongyao_2923: number
  user_identity_auth: number
  bawangchaji_2023: number
  guangzhiye_2023: number
  user_reality_auth: number
  gaokaojiayou_2023: number
  baokemeng_2023: number
  haimianbaobaoguoshengdan_2023: number
  xugexingyuan_2023: number
  fendi_2023: number
  lianyusheng1_2024: number
  lianyusheng2_2024: number
  lianyusheng3_2024: number
  guangyuyezhilian_2024: number
  article_visible: number
  ganmaoling_2024: number
  yuanmengzhixing_2024: number
  nihaochuntian_2024: number
  lvzhilingyang_2024: number
  status_visible_y: number
  hangmu_2024: number
  guangyuye_2024: number
  gaokao_2024: number
  biyeji_2024: number
  sqjnhdianshi_2024: number
  purchased_paid_content: number
  changxiangsi_2024: number
  zhuamaomao_2024: number
  aoyun_2024: number
  xiariqingchunpaidui_2024: number
  renrengongyijie_2024: number
  kaixueji_2024: number
  jiaoshijie_2024: number
  zhongqiu_2024: number
  ruyuan_2024: number
  guoqi1001_2024: number
  hepingjingying_2024: number
  acg_2024: number
  bawangchaji_2024: number
  tymyd_2024: number
  mrxy_2024: number
  hrsj_2025: number
  kxn_2025: number
  cw_2025: number
  lzly_2025: number
  luhanzq_2025: number
  muqinjie_2025: number
  duohashibin_2025: number
  gaokao_2025: number
  kenan_2025: number
}

export interface Extend {
  privacy: Privacy
  mbprivilege: string
}

export interface Privacy {
  mobile: number
}

export interface PicInfos2 {
  '61ecce97ly1gh9wdjiomgj20nm2o5u0x': N61ecce97ly1gh9wdjiomgj20nm2o5u0x2
}

export interface N61ecce97ly1gh9wdjiomgj20nm2o5u0x2 {
  thumbnail: Thumbnail2
  bmiddle: Bmiddle2
  large: Large2
  original: Original2
  largest: Largest2
  mw2000: Mw20002
  largecover: Largecover2
  object_id: string
  pic_id: string
  photo_tag: number
  type: string
  pic_status: number
}

export interface Thumbnail2 {
  url: string
  width: number
  height: number
  cut_type: number
  type: any
}

export interface Bmiddle2 {
  url: string
  width: number
  height: number
  cut_type: number
  type: any
}

export interface Large2 {
  url: string
  width: number
  height: number
  cut_type: number
  type: any
}

export interface Original2 {
  url: string
  width: number
  height: number
  cut_type: number
  type: any
}

export interface Largest2 {
  url: string
  width: number
  height: number
  cut_type: number
  type: any
}

export interface Mw20002 {
  url: string
  width: number
  height: number
  cut_type: number
  type: any
}

export interface Largecover2 {
  url: string
  width: number
  height: number
  cut_type: number
  type: any
}

export interface TopicStruct {
  title: string
  topic_url: string
  topic_title: string
  actionlog: Actionlog
}

export interface Actionlog {
  act_type: number
  act_code: number
  oid: string
  uuid: number
  cardid: string
  lcardid: string
  uicode: string
  luicode: string
  fid: string
  lfid: string
  ext: string
}

export interface CommentManageInfo {
  comment_permission_type: number
  approval_comment_type: number
  comment_sort_type: number
}

export interface TopicStruct2 {
  title: string
  topic_url: string
  topic_title: string
  actionlog: Actionlog2
}

export interface Actionlog2 {
  act_type: number
  act_code: number
  oid: string
  uuid: number
  cardid: string
  lcardid: string
  uicode: string
  luicode: string
  fid: string
  lfid: string
  ext: string
}

export interface Title {
  text: string
  base_color: number
  icon_url: string
}
