# SVG closepath regression sources

`x-square.svg` and `check-square.svg` are unmodified Bootstrap Icons files pinned to [6945b7006285d444cc17ff2e22c7691719229526](https://github.com/twbs/icons/tree/6945b7006285d444cc17ff2e22c7691719229526/icons), distributed under the adjacent MIT LICENSE. SHA-256 and expected visible shapes are recorded in `compatibility/profiles/svg.json`.

`tests/helpers/svg-closepath.js` generates 48 deterministic malformed variants and valid/corrupt derivatives of these two real files. Chrome compares native malformed-path pixels with the native valid prefix, and reader pixels with the reader valid prefix. Synthetic triangle pixels must also exactly equal native pixels. Real icon arc differences are recorded, not hidden by relaxing a threshold.

Run `node scripts/verify-svg-closepath.js`; review `outputs/svg-closepath/oracle.html` and `report.json`. `node scripts/verify-svg-closepath-wechat.js` requires this exact worktree loaded in DevTools automation. It opens animated variants through the real reader and compares actual Canvas pixel hashes across each valid/corrupt pair. These are not physical-device results.
