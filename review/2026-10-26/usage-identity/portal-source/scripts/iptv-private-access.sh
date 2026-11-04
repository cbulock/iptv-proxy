#!/bin/sh
# Preserve LAN/VPN tuner access while preventing direct public backend access.
set -eu
iptables -N BULOCK-IPTV-PRIVATE 2>/dev/null || true
for network in 127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10; do
  iptables -C BULOCK-IPTV-PRIVATE -s "$network" -j RETURN 2>/dev/null || iptables -A BULOCK-IPTV-PRIVATE -s "$network" -j RETURN
done
iptables -C BULOCK-IPTV-PRIVATE -j DROP 2>/dev/null || iptables -A BULOCK-IPTV-PRIVATE -j DROP
for port in 34400 34401; do
  iptables -C DOCKER-USER -p tcp -m conntrack --ctorigdstport "$port" -j BULOCK-IPTV-PRIVATE 2>/dev/null || iptables -I DOCKER-USER 1 -p tcp -m conntrack --ctorigdstport "$port" -j BULOCK-IPTV-PRIVATE
  iptables -C INPUT -p tcp --dport "$port" -j BULOCK-IPTV-PRIVATE 2>/dev/null || iptables -I INPUT 1 -p tcp --dport "$port" -j BULOCK-IPTV-PRIVATE
done
ip6tables -N BULOCK-IPTV-PRIVATE 2>/dev/null || true
for network in ::1/128 fc00::/7 fe80::/10; do
  ip6tables -C BULOCK-IPTV-PRIVATE -s "$network" -j RETURN 2>/dev/null || ip6tables -A BULOCK-IPTV-PRIVATE -s "$network" -j RETURN
done
ip6tables -C BULOCK-IPTV-PRIVATE -j DROP 2>/dev/null || ip6tables -A BULOCK-IPTV-PRIVATE -j DROP
for port in 34400 34401; do
  ip6tables -C INPUT -p tcp --dport "$port" -j BULOCK-IPTV-PRIVATE 2>/dev/null || ip6tables -I INPUT 1 -p tcp --dport "$port" -j BULOCK-IPTV-PRIVATE
  if ip6tables -S DOCKER-USER >/dev/null 2>&1; then
    ip6tables -C DOCKER-USER -p tcp -m conntrack --ctorigdstport "$port" -j BULOCK-IPTV-PRIVATE 2>/dev/null || ip6tables -I DOCKER-USER 1 -p tcp -m conntrack --ctorigdstport "$port" -j BULOCK-IPTV-PRIVATE
  fi
done
