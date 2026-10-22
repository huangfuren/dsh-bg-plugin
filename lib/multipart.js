/**
 * multipart/form-data 解析（零依赖，只覆盖本插件需要的那一小片：取表单字段与文件段）。
 *
 * 相比手写逐字节扫描，这里一律用 `Buffer.indexOf` 定位分隔符 —— 它在原生层跑，
 * 16MB 载荷也是毫秒级；旧实现对每个字节做 JS 级循环，是上传慢的第二个放大器
 * （第一个是 base64 编解码）。
 *
 * 已知边界：若某张图片的二进制数据里恰好含有与 boundary 完全相同的字节序列，会被
 * 误判为分段边界。这是 multipart 格式本身的固有性质，浏览器生成的 boundary 足够
 * 随机，实际不会命中；要彻底规避只能整段解码，代价远大于收益。
 */

const CRLF = Buffer.from('\r\n')
const HEADER_END = Buffer.from('\r\n\r\n')

/**
 * 解析 multipart 请求体。
 *
 * @param {Buffer} body 完整请求体
 * @param {string} boundary content-type 里声明的 boundary（不含前导 `--`）
 * @returns {{fields: Record<string,string>, files: Array<{name:string, filename:string, type:string, data:Buffer}>}|null}
 *          结构不合法（缺分隔符、缺头部终止、未闭合）时返回 null。
 */
export function parseMultipart(body, boundary) {
  if (!Buffer.isBuffer(body) || body.length === 0) return null
  if (typeof boundary !== 'string' || boundary === '') return null

  const delim = Buffer.from('--' + boundary)
  const fields = {}
  const files = []
  let pos = body.indexOf(delim)
  if (pos === -1) return null

  // 最多解析 32 段，防止构造畸形请求把宿主拖进长循环。
  for (let guard = 0; guard < 32; guard += 1) {
    pos += delim.length
    // 结束分隔符是 `--boundary--`。
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break
    // 分隔符后允许 CRLF（首段之前有时也带 transport padding，这里只处理 CRLF）。
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2

    const headerEnd = body.indexOf(HEADER_END, pos)
    if (headerEnd === -1) return null
    const headerText = body.toString('utf8', pos, headerEnd)
    const contentStart = headerEnd + HEADER_END.length

    const nextDelim = body.indexOf(delim, contentStart)
    if (nextDelim === -1) return null
    let contentEnd = nextDelim
    // 每个部分的内容后面跟着 CRLF 再是分隔符，这两字节不属于内容。
    if (contentEnd >= 2 && body[contentEnd - 1] === 0x0a && body[contentEnd - 2] === 0x0d) contentEnd -= 2

    const part = parseHeaders(headerText)
    const data = body.subarray(contentStart, contentEnd)
    if (part.filename !== '') {
      files.push({ name: part.name, filename: part.filename, type: part.type, data })
    } else if (part.name !== '') {
      fields[part.name] = data.toString('utf8')
    }
    pos = nextDelim
  }

  return { fields, files }
}

/** 从单个部分的头部文本里取 name / filename / content-type。 */
function parseHeaders(headerText) {
  const name = matchOne(headerText, /;\s*name="([^"]*)"/i) ?? matchOne(headerText, /^name:\s*([^\r\n]+)/im) ?? ''
  const filename = decodeFilename(headerText)
  const type = (matchOne(headerText, /content-type:\s*([^\r\n;]+)/i) || '').trim()
  return { name, filename, type }
}

function matchOne(text, re) {
  const m = re.exec(text)
  return m ? m[1] : null
}

/**
 * 取文件名。优先 RFC 5987 的 `filename*=UTF-8''xxx`（中文名走这条），
 * 回退到普通 `filename="xxx"`。
 */
function decodeFilename(headerText) {
  const ext = /filename\*=\s*([^;\r\n]+)/i.exec(headerText)
  if (ext) {
    const raw = ext[1].trim()
    const m = /^[^']*'[^']*'(.*)$/.exec(raw)
    const encoded = m ? m[1] : raw
    try { return decodeURIComponent(encoded) } catch { /* 落到普通字段 */ }
  }
  const plain = /filename="([^"]*)"/i.exec(headerText)
  if (plain) return plain[1]
  const bare = /filename=([^;\r\n]+)/i.exec(headerText)
  return bare ? bare[1].trim() : ''
}

/**
 * 从 content-type 里取 boundary。
 * @returns {string|null}
 */
export function boundaryOf(contentType) {
  if (typeof contentType !== 'string') return null
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)
  if (!m) return null
  const value = (m[1] || m[2] || '').trim()
  return value === '' ? null : value
}

/** 仅供测试使用：拼一个最小 multipart 请求体。 */
export function buildMultipartBody(boundary, parts) {
  const chunks = []
  for (const part of parts) {
    const header = ['--' + boundary]
    const disp = `form-data; name="${part.name}"`
    header.push('Content-Disposition: ' + disp + (part.filename === undefined ? '' : `; filename="${part.filename}"`))
    if (part.type) header.push('Content-Type: ' + part.type)
    chunks.push(Buffer.from(header.join('\r\n') + '\r\n\r\n'))
    chunks.push(Buffer.isBuffer(part.data) ? part.data : Buffer.from(String(part.data ?? '')))
    chunks.push(CRLF)
  }
  chunks.push(Buffer.from('--' + boundary + '--\r\n'))
  return Buffer.concat(chunks)
}
