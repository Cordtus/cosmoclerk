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
        message_id: Option<teloxide::types::MessageId>,
        last_selected_chain: Option<String>,
    },
    ChainSelected {
        chain: String,
        message_id: Option<teloxide::types::MessageId>,
    },
    AwaitingIbcDenom {
        chain: String,
        message_id: Option<teloxide::types::MessageId>,
    },
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
        .branch(case![commands::Command::Help].endpoint(handlers::help))
        .branch(case![commands::Command::Testnet].endpoint(handlers::show_testnets))
        .branch(case![commands::Command::Testnets].endpoint(handlers::show_testnets))
        .branch(case![commands::Command::Mainnet].endpoint(handlers::show_mainnets))
        .branch(case![commands::Command::Mainnets].endpoint(handlers::show_mainnets));

    let message_handler = Update::filter_message()
        .branch(command_handler)
        .branch(case![State::AwaitingIbcDenom { chain, message_id }].endpoint(handlers::handle_ibc_denom))
        .branch(dptree::endpoint(handlers::handle_text));

    let callback_handler = Update::filter_callback_query()
        .branch(case![State::SelectingChain { page, is_testnet, message_id, last_selected_chain }].endpoint(handlers::handle_chain_selection))
        .branch(case![State::ChainSelected { chain, message_id }].endpoint(handlers::handle_chain_action))
        .branch(dptree::endpoint(handlers::handle_callback));

    dialogue::enter::<Update, InMemStorage<State>, State, _>()
        .branch(message_handler)
        .branch(callback_handler)
}