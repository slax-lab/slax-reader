import Hashids from 'hashids'

function stringToNumber(str: string): number {
  let result = 0
  for (let i = 0; i < str.length; i++) {
    result = result * 256 + str.charCodeAt(i)
  }
  return result
}

function numberToString(num: number): string {
  let str = ''
  while (num > 0) {
    str = String.fromCharCode(num % 256) + str
    num = Math.floor(num / 256)
  }
  return str
}

const userId = undefined

console.log('new')
const client = new Hashids('slax-----rrrr' + String(userId || 0))

const enId = client.encode('10000000')
console.log(stringToNumber(enId))

console.log('parse')
const enUserId = stringToNumber(enId)

console.log('hex', enUserId)
const hexUserId = numberToString(enUserId)

console.log('decode', hexUserId)
const decodeId = client.decode(hexUserId)

console.log('decodeId', decodeId)
