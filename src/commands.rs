use teloxide::utils::command::BotCommands;

#[derive(BotCommands, Clone)]
#[command(rename_rule = "lowercase", description = "These commands are supported:")]
pub enum Command {
    #[command(description = "Start the bot")]
    Start,
    #[command(description = "Restart and clear session")]
    Restart,
    #[command(description = "Display help")]
    Help,
    #[command(description = "Show testnet chains")]
    Testnet,
    #[command(description = "Show testnet chains")]
    Testnets,
    #[command(description = "Show mainnet chains")]
    Mainnet,
    #[command(description = "Show mainnet chains")]
    Mainnets,
}