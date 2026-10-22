/**
 * multipart 解析的回归测试。
 *
 * 这条路径以前没有测试，而它直接决定「上传能不能用」：分隔符定位偏一字节，
 * 落盘的就是一张尾部多两字节 CRLF 的坏图。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMultipart, boundaryOf, buildMultipartBody } from '../bg/lib/multipart.js'
import { pngBytes } from './helpers.mjs'

const BOUNDARY = '----dshbgBoundary1234'

test('解析单文件表单并保留原始字节', () => {
  const image = pngBytes(64, 32)
  const body = buildMultipartBody(BOUNDARY, [
    { name: 'file', filename: 'wall.png', type: 'image/png', data: image },
  ])
  const parsed = parseMultipart(body, BOUNDARY)
  assert.ok(parsed)
  assert.equal(parsed.files.length, 1)
  assert.equal(parsed.files[0].name, 'file')
  assert.equal(parsed.files[0].filename, 'wall.png')
  assert.equal(parsed.files[0].type, 'image/png')
  // 逐字节一致：既不能少尾部的 CRLF，也不能把分隔符带进来。
  assert.deepEqual(parsed.files[0].data, image)
})

test('二进制内容里含 CRLF 与 0xFF 也不会错位', () => {
  const image = Buffer.concat([pngBytes(10, 10), Buffer.from([0x0d, 0x0a, 0xff, 0xd8, 0x0d, 0x0a])])
  const body = buildMultipartBody(BOUNDARY, [
    { name: 'file', filename: 'a.png', type: 'image/png', data: image },
  ])
  const parsed = parseMultipart(body, BOUNDARY)
  assert.deepEqual(parsed.files[0].data, image)
})

test('同时解析文本字段与文件字段', () => {
  const body = buildMultipartBody(BOUNDARY, [
    { name: 'mode', data: 'cover' },
    { name: 'file', filename: 'b.jpg', type: 'image/jpeg', data: Buffer.from([1, 2, 3]) },
  ])
  const parsed = parseMultipart(body, BOUNDARY)
  assert.equal(parsed.fields.mode, 'cover')
  assert.equal(parsed.files.length, 1)
  assert.deepEqual(parsed.files[0].data, Buffer.from([1, 2, 3]))
})

test('多个文件按顺序返回', () => {
  const body = buildMultipartBody(BOUNDARY, [
    { name: 'file', filename: '1.png', type: 'image/png', data: Buffer.from('one') },
    { name: 'file', filename: '2.png', type: 'image/png', data: Buffer.from('two') },
  ])
  const parsed = parseMultipart(body, BOUNDARY)
  assert.equal(parsed.files.length, 2)
  assert.equal(parsed.files[0].filename, '1.png')
  assert.equal(parsed.files[1].filename, '2.png')
})

test('RFC 5987 的中文文件名可解码', () => {
  const body = Buffer.concat([
    Buffer.from('--' + BOUNDARY + '\r\n'),
    Buffer.from("Content-Disposition: form-data; name=\"file\"; filename*=UTF-8''%E5%A3%81%E7%BA%B8.png\r\n"),
    Buffer.from('Content-Type: image/png\r\n\r\n'),
    Buffer.from([1, 2, 3]),
    Buffer.from('\r\n--' + BOUNDARY + '--\r\n'),
  ])
  const parsed = parseMultipart(body, BOUNDARY)
  assert.equal(parsed.files[0].filename, '壁纸.png')
})

test('结构损坏时返回 null 而不是抛异常', () => {
  assert.equal(parseMultipart(Buffer.alloc(0), BOUNDARY), null)
  assert.equal(parseMultipart(Buffer.from('not multipart at all'), BOUNDARY), null)
  assert.equal(parseMultipart(Buffer.from('anything'), ''), null)
  // 有开头分隔符、没有结束分隔符
  const truncated = Buffer.from('--' + BOUNDARY + '\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n\r\nabc')
  assert.equal(parseMultipart(truncated, BOUNDARY), null)
})

test('boundary 解析兼容带引号与不带引号', () => {
  assert.equal(boundaryOf('multipart/form-data; boundary=' + BOUNDARY), BOUNDARY)
  assert.equal(boundaryOf('multipart/form-data; boundary="' + BOUNDARY + '"'), BOUNDARY)
  assert.equal(boundaryOf('multipart/form-data'), null)
  assert.equal(boundaryOf(undefined), null)
})
