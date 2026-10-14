package com.slax.reader.platform

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.io.ByteArrayOutputStream

object SlaxDns {
  fun lookup(host: String, server: String): String {
    require(server == "8.8.8.8" || server == "1.1.1.1") { "Unsupported diagnostic DNS server" }
    val id = java.security.SecureRandom().nextInt(65536)
    val bytes = ByteArrayOutputStream()
    fun number(value: Int) { bytes.write(value shr 8 and 255); bytes.write(value and 255) }
    number(id); number(0x0100); number(1); number(0); number(0); number(0)
    host.split('.').forEach { label -> val part = label.toByteArray(Charsets.US_ASCII); require(part.size in 1..63); bytes.write(part.size); bytes.write(part) }
    bytes.write(0); number(1); number(1)
    val request = bytes.toByteArray()
    return DatagramSocket().use { socket ->
      socket.soTimeout = 5000
      socket.connect(InetAddress.getByName(server), 53)
      socket.send(DatagramPacket(request, request.size))
      val data = ByteArray(4096); val packet = DatagramPacket(data, data.size); socket.receive(packet)
      val size = packet.length
      fun u16(index: Int): Int { require(index + 1 < size) { "Truncated DNS response" }; return (data[index].toInt() and 255 shl 8) or (data[index + 1].toInt() and 255) }
      require(u16(0) == id && u16(2) and 0x800f == 0x8000) { "Invalid DNS response" }
      fun skipName(offset: Int): Int {
        var index = offset
        repeat(128) {
          require(index < size) { "Truncated DNS name" }
          val length = data[index++].toInt() and 255
          if (length == 0) return index
          if (length and 192 == 192) { require(index < size); return index + 1 }
          require(length <= 63); index += length
        }
        error("Invalid DNS name")
      }
      var index = 12
      repeat(u16(4)) { index = skipName(index) + 4 }
      val result = mutableListOf<String>()
      repeat(u16(6)) {
        index = skipName(index)
        val type = u16(index); val length = u16(index + 8); index += 10
        require(index + length <= size) { "Truncated DNS answer" }
        if (type == 1 && length == 4) result.add(InetAddress.getByAddress(data.copyOfRange(index, index + length)).hostAddress.orEmpty())
        index += length
      }
      check(result.isNotEmpty()) { "No DNS address returned" }; result.joinToString(", ")
    }
  }
}
