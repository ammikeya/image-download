# Image Selector Downloader (Chrome 扩展)

输入 CSS 选择器，高亮页面中匹配的图片（`<img>`），并将匹配到的图片打包为 zip，通过浏览器下载。

## 安装（开发模式）

1. 打开 Chrome → `chrome://extensions/`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目目录：`/Users/liushuiyuan/Desktop/test/image-download`

## 使用

1. 打开任意包含图片的网页
2. 点击扩展图标打开侧边栏（可在浏览器左侧或右侧显示）
3. 输入 CSS 选择器（例如：`.gallery img` 或 `img.hero`）
4. 点击「高亮」：页面中匹配的图片会被红色虚线框标出，侧边栏会显示匹配数量
5. 点击「下载 zip」：扩展会抓取这些图片并生成 zip，然后由浏览器下载

## 说明 / 限制

- 仅对 `<img>` 元素生效（选择器匹配到的非 `<img>` 元素会被忽略）。
- 某些图片可能因为防盗链/鉴权/网络等原因抓取失败；如果部分失败，zip 中会附带 `__failed.txt` 记录失败原因。
- 在 Chrome 限制页面（如 `chrome://`、Chrome Web Store）内容脚本无法运行，这是浏览器限制。

