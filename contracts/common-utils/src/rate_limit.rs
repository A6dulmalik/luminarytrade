use soroban_sdk::{contracttype, Env, Address, Map};

#[contracttype]
#[derive(Clone)]
pub struct RateLimit {
    pub count: u32,
    pub window_start: u64,
}

#[contracttype]
pub struct Config {
    pub limit: u32,
    pub window: u64, // blocks
}

const RATE_LIMIT: symbol_short!("rl");
const CONFIG: symbol_short!("cfg");

pub fn check_rate_limit(e: &Env, addr: Address) {
    let mut store: Map<Address, RateLimit> =
        e.storage().instance().get(&RATE_LIMIT).unwrap_or(Map::new(e));

    let cfg: Config = e.storage().instance().get(&CONFIG).unwrap();

    let ledger = e.ledger().sequence();
    let mut rl = store.get(addr.clone()).unwrap_or(RateLimit {
        count: 0,
        window_start: ledger,
    });

    // reset window
    if ledger - rl.window_start > cfg.window {
        rl.count = 0;
        rl.window_start = ledger;
    }

    if rl.count >= cfg.limit {
        panic!("RateLimitExceeded");
    }

    rl.count += 1;
    store.set(addr, rl);

    e.storage().instance().set(&RATE_LIMIT, &store);
}