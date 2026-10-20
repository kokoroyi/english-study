# 第三方组件与数据声明

本项目（English Study）在 MIT 许可证下发布。以下为本项目分发/依赖的第三方内容及其许可证说明。

## 1. Plus Jakarta Sans 字体

`src/renderer/src/assets/fonts/` 下的 Plus Jakarta Sans 字体文件版权归 The Plus Jakarta Sans Project Authors，
以 SIL Open Font License 1.1 授权，允许随软件一起分发。

Copyright 2020 The Plus Jakarta Sans Project Authors (https://github.com/tokotype/PlusJakartaSans)

以下为 SIL Open Font License 1.1 全文：

```
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## 2. ECDICT 词典数据（由用户自行下载，不随仓库分发）

本项目不包含 ECDICT 词典文件。`setup.bat` 会从 ECDICT 官方 GitHub Release 下载，用户也可以手动下载。
ECDICT 项目以 MIT 许可证发布：

- 项目主页：https://github.com/skywind3000/ECDICT
- 下载页：https://github.com/skywind3000/ECDICT/releases
- 许可证：MIT

## 3. Bionic Reading 阅读辅助概念

「仿生阅读 / Bionic Reading」是一种通过加粗词首引导视线的阅读辅助概念。本项目的仿生阅读渲染与语义关键词高亮均为
独立实现，参考公开的阅读辅助思路，不包含任何第三方阅读插件的源代码，也不隶属于 Bionic Reading 商标持有方或任何
阅读插件作者。相关名称仅用于描述功能。

## 4. 运行时依赖

主要 npm 依赖及其许可证（完整依赖树见 `package-lock.json`）：

| 依赖 | 许可证 |
|---|---|
| Electron | MIT |
| Vue / vue-router | MIT |
| better-sqlite3 | MIT |
| electron-vite / Vite / @vitejs/plugin-vue | MIT |
| electron-builder | MIT |

如发现遗漏或版权问题，请通过仓库 Issue 联系维护者更正。
