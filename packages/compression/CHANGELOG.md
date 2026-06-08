# @nodellmcache/compression

## 1.0.0

### Minor Changes

- f38cbec: Initial release of `@nodellmcache/compression`: a pure-JS `CompressionEngine` implementing Brotli and Gzip (built-in `zlib`) and LZ4 (`lz4js`), with `auto` codec selection by payload size and data hint (`<1KB` none, `1–50KB` lz4, `>50KB` brotli; `embedding`→lz4, `text`→brotli), plus `stats()` for ratio/savings. No native bindings.

### Patch Changes

- Updated dependencies [a2633d8]
  - @nodellmcache/core@1.0.0
