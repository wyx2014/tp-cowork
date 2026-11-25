# dsh-pet 🐾

一只住在 DeepSeek Harness 里的桌面宠物，一百余个透明动画，可多开、能上桌面。

安装与完整文档：**<https://github.com/PC2005-cloud/dsh-pet>**

许可：代码 MIT；素材禁止商用；二创在公开渠道须署名（同上链接）。

TP Cowork 的本地维护版本基于上游 npm 0.4.9 对应的 Git 提交
[`1471bb6`](https://github.com/PC2005-cloud/dsh-pet/tree/1471bb61382f3dec6a788d8a5e03c632b1c27b50/dsh-pet)。

- `src/host` 包含宿主插件和桌宠接口。
- `src/client` 包含应用内桌宠、配置页和对话界面。
- `runtime/electron-helper` 包含独立桌宠窗口的代码。
- `assets/config.jsonc` 包含默认配置，`assets/webm` 存放 CoWork 的招手、敲键盘、思考和疑问动画。

在 TP Cowork 根目录执行 `npm run dev` 会根据源码变化构建并链接此目录。Windows 和 Linux 标准安装包从同一份源码构建。

角色形象为社区二创的「大肥鱼」，原型「溟月」出自 [上善无形](https://space.bilibili.com/4456176)，
女仆鲸鱼娘版出自 [ZipZipPipe](https://space.bilibili.com/4168597)。角色素材遵循
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)。
授权和公开署名约定见[上游项目说明](https://github.com/PC2005-cloud/dsh-pet#许可)。
