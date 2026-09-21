import fs from 'fs'
import path from 'path'
import type { ResolvedPublicFile, Wxt } from 'wxt'

const autoMigrateIcons = (mode: string) => {
  return (wxt: Wxt, file: ResolvedPublicFile[]) => {
    const fromPath = path.resolve(__dirname, `../dev_assets/icons/${mode}`)

    fs.readdirSync(fromPath).forEach(imgFile => {
      file.push({
        absoluteSrc: path.join(fromPath, imgFile),
        relativeDest: `icon/${imgFile}`
      })
    })
  }
}

export default autoMigrateIcons
