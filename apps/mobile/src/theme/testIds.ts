/** Stable source semantics identifiers, independent of localization. */
export const mobileTestIds = {
  AddLinkDialog: 'add_link_dialog',
  AddLinkInput: 'add_link_input',
  AddLinkConfirm: 'add_link_confirm',
  AddLinkClose: 'add_link_close',
  AddLinkError: 'add_link_error',
  EmptyInbox: 'empty_inbox',
  EmptyOrLoading: 'empty_or_loading',
  LoadingIndicator: 'loading_indicator',
  BookmarkItemStatus: 'bookmark_item_status',
  PageIndicator: 'page_indicator',
  SelectionActionBar: 'selection_action_bar',
  PageIndicatorItemPrefix: 'page_indicator_item_',
  DetailSkeleton: 'detail_skeleton',
  TagItem: 'tag_item',
  BookmarkAlertDialog: 'bookmark_alert_dialog',
  LoginButton: 'login_button',
  LoginLoadingIndicator: 'login_loading_indicator',
  SettingScreen: 'setting_screen',
  SettingLanguage: 'setting_language',
  SettingDeleteAccount: 'setting_delete_account',
  FeedbackScreen: 'feedback_screen',
  FeedbackInput: 'feedback_input',
  FeedbackSubmit: 'feedback_submit',
  SidebarDrawer: 'sidebar_drawer',
} as const;

export type MobileTestId = (typeof mobileTestIds)[keyof typeof mobileTestIds];
