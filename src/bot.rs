use crate::{cache::RegistryCache, commands, handlers};
use std::sync::Arc;
use teloxide::{
    dispatching::{dialogue, dialogue::InMemStorage, UpdateHandler},
    prelude::*,
};

pub type MyDialogue = Dialogue<State, InMemStorage<State>>;

#[derive(Clone, Default)]
pub enum State {
    #[default]
    Start,
    SelectingChain {
        page: usize,
        is_testnet: bool,
    },
    ChainSelected {
        chain: String,
    },
    AwaitingIbcDenom {
        chain: String,
    },
    AwaitingPoolId {
        chain: String,
        action: PoolAction,
    },
    AwaitingTokenTicker {
        chain: String,
    },
}

#[derive(Clone)]
pub enum PoolAction {
    Incentives,
    Info,
}

pub async fn run(bot: Bot) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cache = Arc::new(RegistryCache::new(30)); // 30 minute TTL

    Dispatcher::builder(bot, schema())
        .dependencies(dptree::deps![InMemStorage::<State>::new(), cache])
        .enable_ctrlc_handler()
        .build()
        .dispatch()
        .await;

    Ok(())
}

fn schema() -> UpdateHandler<Box<dyn std::error::Error + Send + Sync + 'static>> {
    use dptree::case;

    let command_handler = teloxide::filter_command::<commands::Command, _>()
        .branch(case![commands::Command::Start].endpoint(handlers::start))
        .branch(case![commands::Command::Restart].endpoint(handlers::restart))
        .branch(case![commands::Command::Help].endpoint(handlers::help));

    let message_handler = Update::filter_message()
        .branch(command_handler)
        .branch(case![State::AwaitingIbcDenom { chain }].endpoint(handlers::handle_ibc_denom))
        .branch(
            case![State::AwaitingPoolId { chain, action }].endpoint(handlers::handle_pool_id),
        )
        .branch(
            case![State::AwaitingTokenTicker { chain }].endpoint(handlers::handle_token_ticker),
        )
        .branch(dptree::endpoint(handlers::handle_text));

    let callback_handler = Update::filter_callback_query()
        .branch(case![State::SelectingChain { page, is_testnet }].endpoint(handlers::handle_chain_selection))
        .branch(case![State::ChainSelected { chain }].endpoint(handlers::handle_chain_action))
        .branch(dptree::endpoint(handlers::handle_callback));

    dialogue::enter::<Update, InMemStorage<State>, State, _>()
        .branch(message_handler)
        .branch(callback_handler)
}