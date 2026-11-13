//! 不开浏览器，用播放器后端 SDK 跑一个作品并打印它的日志输出。
//!
//! ```text
//! cargo run --release --example headless_player -- samples/native-studio.bcmkn 120
//! ```
use anyhow::{Context, Result};
use nekoc::player::{FrameInput, Handshake, InputEvent, Player};

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let path = args
        .next()
        .context("usage: headless_player <作品.bcmkn|.bcm> [帧数]")?;
    let frames: usize = args.next().map_or(Ok(60), |n| n.parse())?;

    // .bcmkn 和 Kitten4 .bcm 都先转成规范 KN JSON。
    let (project, report) = nekoc::player::import(nekoc::project::load_project(&path)?.value)?;
    eprintln!("format: {}", report["format"]);
    let mut player = Player::load(Handshake::new(project))?;
    eprintln!("ready: {}", player.ready_message());

    for n in 0..frames {
        let mut input = FrameInput::default();
        // 第一帧按一下空格（按键用 keyCode 字符串），演示怎么送输入事件。
        if n == 0 {
            input.events = [true, false]
                .map(|down| InputEvent::Key {
                    key: "32".into(),
                    down,
                })
                .into();
        }
        let frame = player.step(&input)?;
        for line in &frame.logs {
            println!("[{}] {line}", frame.sequence);
        }
        player.recycle(frame);
    }
    Ok(())
}
