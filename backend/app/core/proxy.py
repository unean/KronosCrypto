import os
from collections.abc import Callable
from urllib.request import getproxies

_REQUESTS_PATCHED = False
_CCXT_PATCHED = False


def get_system_proxies() -> dict[str, str]:
    raw_proxies = getproxies()
    proxies: dict[str, str] = {}

    http_proxy = raw_proxies.get("http") or raw_proxies.get("all")
    https_proxy = raw_proxies.get("https") or raw_proxies.get("all") or http_proxy

    if http_proxy:
        proxies["http"] = http_proxy
    if https_proxy:
        proxies["https"] = https_proxy

    return proxies


def apply_system_proxy() -> dict[str, str]:
    global _REQUESTS_PATCHED, _CCXT_PATCHED

    proxies = get_system_proxies()

    http_proxy = proxies.get("http")
    https_proxy = proxies.get("https")
    no_proxy = getproxies().get("no")

    if http_proxy:
        os.environ.setdefault("HTTP_PROXY", http_proxy)
        os.environ.setdefault("http_proxy", http_proxy)
    if https_proxy:
        os.environ.setdefault("HTTPS_PROXY", https_proxy)
        os.environ.setdefault("https_proxy", https_proxy)
    if no_proxy:
        os.environ.setdefault("NO_PROXY", no_proxy)
        os.environ.setdefault("no_proxy", no_proxy)

    if proxies and not _REQUESTS_PATCHED:
        _patch_requests_session(proxies)
        _REQUESTS_PATCHED = True
    if proxies and not _CCXT_PATCHED:
        _patch_ccxt_exchange(proxies)
        _CCXT_PATCHED = True

    return proxies


def _patch_requests_session(proxies: dict[str, str]) -> None:
    try:
        import requests
    except ImportError:
        return

    original_init: Callable = requests.Session.__init__

    def init_with_proxy(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self.proxies.update(proxies)

    requests.Session.__init__ = init_with_proxy


def _patch_ccxt_exchange(proxies: dict[str, str]) -> None:
    try:
        import ccxt
    except ImportError:
        return

    original_init: Callable = ccxt.Exchange.__init__

    def init_with_proxy(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        if not self.proxies:
            self.proxies = proxies.copy()

    ccxt.Exchange.__init__ = init_with_proxy
