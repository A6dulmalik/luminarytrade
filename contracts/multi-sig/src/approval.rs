use soroban_sdk::{contracttype, Address, Vec};

#[contracttype]
#[derive(Clone)]
pub struct ApprovalRequest {
    pub id: u64,
    pub signers: Vec<Address>,
    pub approvals: Vec<Address>,
    pub threshold: u32,
    pub deadline: u64,
}