import socket

clientsock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
clientsock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1);
while True:
    msg = raw_input("send Message > ")
    clientsock.sendto(unicode(msg, "utf8").encode("utf16"), ('255.255.255.255', 12345));

