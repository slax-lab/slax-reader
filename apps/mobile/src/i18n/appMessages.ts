/** Approved migration protection UI; these keys are not part of the source catalogue. */
export const appMessages = {
  en: {
    upgrade_required_title: 'Upgrade verification required',
    upgrade_required_message: 'Your saved articles and pending offline changes have been kept. This build cannot take ownership of the existing database until upgrade compatibility has been verified.',
    startup_failed_title: 'Unable to start',
    data_open_failed_title: 'Unable to open saved data',
  },
  zh: {
    upgrade_required_title: '需要验证升级兼容性',
    upgrade_required_message: '已保留你的收藏文章和待同步的离线修改。在验证升级兼容性之前，此版本无法接管现有数据库。',
    startup_failed_title: '无法启动',
    data_open_failed_title: '无法打开已保存的数据',
  },
} as const;
