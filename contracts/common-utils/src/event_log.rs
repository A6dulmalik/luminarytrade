use soroban_sdk::{contracttype, Env, Vec, Map, Address};

#[contracttype]
#[derive(Clone)]
pub struct Event {
    pub id: u64,
    pub event_type: u32,
    pub caller: Address,
    pub target: Address,
    pub data: u32,
    pub block: u64,
}

const EVENTS: symbol_short!("evts");
const COUNTER: symbol_short!("cnt");

pub fn log_event(e: &Env, evt: Event) {
    let mut events: Vec<Event> =
        e.storage().instance().get(&EVENTS).unwrap_or(Vec::new(e));

    if events.len() >= 1000 {
        events.remove(0);
    }

    events.push_back(evt);
    e.storage().instance().set(&EVENTS, &events);
}