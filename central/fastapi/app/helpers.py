import asyncio, requests
from .logging import log
from .config import PRIVATE_KEY, CLAW_ADDRESS, BASE_RPC_HTTP, CHAIN_ID
from web3 import Web3
from .abi import claw_abi

def place_bet(addr, amount, deadline, sig) -> bool:
    w3 = Web3(Web3.HTTPProvider(BASE_RPC_HTTP))
    owner = w3.eth.account.from_key(PRIVATE_KEY).address
    txn = w3.eth.contract(address=CLAW_ADDRESS, abi=claw_abi)\
             .functions.bet(addr, amount, deadline, sig)\
             .build_transaction({"from": owner,
                                 "nonce": w3.eth.get_transaction_count(owner),
                                 "chainId": CHAIN_ID})
    signed = w3.eth.account.sign_transaction(txn, private_key=PRIVATE_KEY)
    rcpt   = w3.eth.send_raw_transaction(signed.raw_transaction)
    return w3.eth.wait_for_transaction_receipt(rcpt)["status"] == 1

async def safe_place_bet(loop, *args):
    for attempt in range(3):
        try:
            return await loop.run_in_executor(None, place_bet, *args)
        except (requests.exceptions.RequestException, ConnectionResetError) as e:
            log.warning("RPC error: %s (retry %s/3)", e, attempt + 1)
            await asyncio.sleep(1.5 ** attempt)
    return False
