//! KN 摄像头/语音的显式离线子集；证据见 docs/kn-panel-capture.md。
//! 本模块不申请权限、不打开设备，也不制造音量或识别成功结果。
//! 返回 Deferred 表示官方 Promise 边界；主调度器必须异步恢复线程。

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Block {
    CameraStatus,
    CameraAlpha,
    VoiceVolume,
    VoiceRecognition,
}

pub(super) fn block(block_type: &str) -> Option<Block> {
    Some(match block_type {
        "open_close_webcam" | "open_hide_camera" => Block::CameraStatus,
        "set_camera_alpha" | "set_webcam_alpha" => Block::CameraAlpha,
        "get_voice_volume" => Block::VoiceVolume,
        "voice_recognition" => Block::VoiceRecognition,
        _ => return None,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CameraSwitch {
    On,
    Off,
}

impl CameraSwitch {
    pub(super) fn parse(field: &str) -> Option<Self> {
        match field {
            "turn_on" => Some(Self::On),
            "turn_off" => Some(Self::Off),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Language {
    Chinese,
    English,
}

impl Language {
    pub(super) fn parse(field: &str) -> Option<Self> {
        match field {
            "zh" => Some(Self::Chinese),
            "en" => Some(Self::English),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Notice {
    IgnoredAlpha,
    RecordBusy,
    LoginRequired,
}

/// 官方域函数即便没有 await 分支也返回 Promise，而非同步 void。
/// 不规定“一帧”等于一个 microtask；由集成方自己的异步队列消费。
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Deferred<T> {
    pub(super) value: T,
    pub(super) notice: Option<Notice>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Unsupported {
    Camera,
    Microphone,
    Recognition,
}

/// 显式 profile，不把“没有后端”偷换成“麦克风被占用”。
/// 集成方目前只能选 unauthenticated + record_enabled=true；需要提供真实
/// 占用状态来源，才能使用 record_enabled=false 的 NaN 分支。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Profile {
    pub(super) record_enabled: bool,
    pub(super) authenticated: bool,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            record_enabled: true,
            authenticated: false,
        }
    }
}

/// 仅代表从未打开过视频流的离线摄像头状态。两个面板操作共享此实例。
/// alpha 是状态控制值，不表示宿主有摄像头或画面已经渲染。
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct OfflineCapture {
    camera_alpha: f64,
}

impl Default for OfflineCapture {
    fn default() -> Self {
        Self { camera_alpha: 0.6 }
    }
}

impl OfflineCapture {
    pub(super) fn camera_alpha(&self) -> f64 {
        self.camera_alpha
    }

    /// 参数必须来自正常求值后的 Cell::Number；其他类型传 None，不能先
    /// 用通用 number() 将字符串/布尔强转。None/NaN 不改变旧状态。
    pub(super) fn set_alpha(&mut self, number: Option<f64>) -> Deferred<()> {
        let notice = match number {
            Some(value) if !value.is_nan() => {
                self.camera_alpha = value.clamp(0.0, 100.0) / 100.0;
                None
            }
            _ => Some(Notice::IgnoredAlpha),
        };
        Deferred { value: (), notice }
    }

    pub(super) fn set_camera(&mut self, switch: CameraSwitch) -> Result<Deferred<()>, Unsupported> {
        match switch {
            // 从未开启/已经关闭时 turnOff 不重置 alpha。
            CameraSwitch::Off => Ok(Deferred {
                value: (),
                notice: None,
            }),
            CameraSwitch::On => Err(Unsupported::Camera),
        }
    }

    // Only an explicit record-disabled host profile can use this helper. The VM
    // deliberately has no reporter dispatch for the default pending-permission path.
    #[allow(dead_code)]
    pub(super) fn voice_volume(&self, profile: Profile) -> Result<Deferred<f64>, Unsupported> {
        if profile.record_enabled {
            return Err(Unsupported::Microphone);
        }
        // 官方在 stopListening() Promise 完成后返回 NaN。该 profile 没有
        // 活动监听器，集成仍须保留异步恢复，而不是内联返回数字。
        Ok(Deferred {
            value: f64::NAN,
            notice: Some(Notice::RecordBusy),
        })
    }

    pub(super) fn recognize(
        &self,
        profile: Profile,
        _language: Language,
    ) -> Result<Deferred<()>, Unsupported> {
        let notice = if !profile.record_enabled {
            Notice::RecordBusy
        } else if !profile.authenticated {
            Notice::LoginRequired
        } else {
            return Err(Unsupported::Recognition);
        };
        // 两个提前返回分支均不改变 get_voice_answer 的已有缓存。
        Ok(Deferred {
            value: (),
            notice: Some(notice),
        })
    }
}
