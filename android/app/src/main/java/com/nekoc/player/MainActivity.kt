package com.nekoc.player

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.provider.OpenableColumns
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket

class MainActivity : ComponentActivity() {
    private val incoming = mutableStateOf<Uri?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        super.onCreate(savedInstanceState)
        incoming.value = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.data
        setContent { NekoTheme { App(incoming) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == Intent.ACTION_VIEW) incoming.value = intent.data
    }
}

@Composable
private fun NekoTheme(content: @Composable () -> Unit) {
    val context = LocalContext.current
    val dark = isSystemInDarkTheme()
    val scheme = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dark -> darkColorScheme()
        else -> lightColorScheme()
    }
    MaterialTheme(colorScheme = scheme) {
        Surface(color = MaterialTheme.colorScheme.background, content = content)
    }
}

private fun worksDir(context: Context) = File(context.filesDir, "works").apply { mkdirs() }

private fun works(context: Context) =
    worksDir(context).listFiles().orEmpty().sortedByDescending { it.lastModified() }

/** 复制到应用私有目录，之后不再依赖原文件的访问授权。 */
private fun importWork(context: Context, uri: Uri): File {
    val resolver = context.contentResolver
    val shown = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
        if (it.moveToFirst()) it.getString(0) else null
    } ?: "作品.bcmkn"
    val name = shown.replace(Regex("[/\\\\:*?\"<>|]"), "_")
    require(name.endsWith(".bcmkn", true) || name.endsWith(".bcm", true) || name.endsWith(".json", true)) {
        "只能打开 .bcmkn、.bcm 或 .json 作品"
    }
    val target = File(worksDir(context), name)
    val input = resolver.openInputStream(uri) ?: error("无法读取文件")
    input.use { from -> target.outputStream().use { from.copyTo(it) } }
    target.setLastModified(System.currentTimeMillis())
    return target
}

@Composable
private fun App(incoming: MutableState<Uri?>) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var playing by remember { mutableStateOf<File?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val open: (Uri) -> Unit = { uri ->
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { importWork(context, uri) } }
                .onSuccess { playing = it }
                .onFailure { error = it.message ?: "打开失败" }
        }
    }
    LaunchedEffect(incoming.value) {
        incoming.value?.let(open)
        incoming.value = null
    }
    val work = playing
    if (work == null) Library(open, { playing = it }, error, { error = null })
    else Player(work) { playing = null }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Library(
    open: (Uri) -> Unit,
    play: (File) -> Unit,
    error: String?,
    clearError: () -> Unit,
) {
    val context = LocalContext.current
    var version by remember { mutableIntStateOf(0) }
    var deleting by remember { mutableStateOf<File?>(null) }
    val list = remember(version) { works(context) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let(open)
    }
    val pick = { picker.launch(arrayOf("*/*")) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(error) {
        error?.let {
            snackbar.showSnackbar(it)
            clearError()
        }
    }
    val scroll = TopAppBarDefaults.pinnedScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            TopAppBar(title = { Text("NekoC") }, scrollBehavior = scroll)
        },
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            if (list.isNotEmpty()) ExtendedFloatingActionButton(
                onClick = pick,
                icon = { Icon(Icons.Filled.Add, null) },
                text = { Text("打开作品") },
            )
        },
    ) { padding ->
        if (list.isEmpty()) {
            Column(
                Modifier.padding(padding).fillMaxSize().padding(32.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Surface(
                    shape = MaterialShapes,
                    color = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(72.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.PlayArrow, null, Modifier.size(36.dp))
                    }
                }
                Spacer(Modifier.height(24.dp))
                Text("还没有作品", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(8.dp))
                Text(
                    "打开 .bcmkn 或 .bcm 文件，由 NekoC 虚拟机直接运行",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(24.dp))
                Button(onClick = pick) {
                    Icon(Icons.Filled.Add, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("打开作品")
                }
            }
        } else {
            LazyColumn(
                contentPadding = PaddingValues(
                    start = 16.dp, end = 16.dp,
                    top = padding.calculateTopPadding() + 8.dp,
                    bottom = padding.calculateBottomPadding() + 96.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(list, key = { it.name }) { file ->
                    Card(
                        onClick = { play(file) },
                        shape = MaterialTheme.shapes.large,
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    ) {
                        ListItem(
                            headlineContent = {
                                Text(file.nameWithoutExtension, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            },
                            supportingContent = {
                                Text("%.1f MB · %s".format(file.length() / 1048576.0, file.extension))
                            },
                            leadingContent = {
                                Surface(
                                    shape = CircleShape,
                                    color = MaterialTheme.colorScheme.primaryContainer,
                                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                                    modifier = Modifier.size(40.dp),
                                ) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Text(
                                            file.name.take(1).uppercase(),
                                            style = MaterialTheme.typography.titleMedium,
                                        )
                                    }
                                }
                            },
                            trailingContent = {
                                IconButton(onClick = { deleting = file }) {
                                    Icon(Icons.Filled.Delete, "删除")
                                }
                            },
                            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                        )
                    }
                }
            }
        }
    }
    deleting?.let { file ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            icon = { Icon(Icons.Filled.Delete, null) },
            title = { Text("删除作品？") },
            text = { Text("将从作品库移除“${file.nameWithoutExtension}”，原文件不受影响。") },
            confirmButton = {
                TextButton(onClick = {
                    file.delete()
                    deleting = null
                    version++
                }) { Text("删除") }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } },
        )
    }
}

private val MaterialShapes = RoundedCornerShape(28.dp)

private class KeyChoice(val code: Int, val label: String)

private class Choice(val label: String, val id: String, val options: List<Pair<String, String>>)

private val CHOICES = listOf(
    Choice("更新上限", "frame-limit", listOf(
        "30" to "30", "60" to "60", "120" to "120", "跟随屏幕" to "0",
        "240" to "240", "480" to "480", "1000" to "1000", "不限" to "-1",
    )),
    Choice("执行预算", "budget", listOf("2 ms" to "2", "4 ms" to "4", "8 ms" to "8", "12 ms" to "12", "16 ms" to "16")),
    Choice("渲染精度", "resolution", listOf("跟随显示" to "0", "0.5×" to "0.5", "1×" to "1", "2×" to "2")),
    Choice("合并无画面更新", "coalesce", listOf("关闭" to "0", "开启" to "1")),
)

private fun fetchKeys(port: Int): List<KeyChoice> {
    val text = java.net.URL("http://127.0.0.1:$port/api/key-buttons").readText()
    val list = org.json.JSONArray(text)
    return (0 until list.length()).map(list::getJSONObject)
        .filter { it.getBoolean("visible") }
        .map { KeyChoice(it.getString("key").toInt(), it.getString("label")) }
}

/** 向舞台发送真实键盘事件，复用播放器已有的输入路径。 */
private fun WebView.key(code: Int, down: Boolean) {
    val type = if (down) "keydown" else "keyup"
    val target = if (down) "document.querySelector('#stage')" else "window"
    evaluateJavascript(
        "$target.dispatchEvent(new KeyboardEvent('$type',{keyCode:$code,which:$code,bubbles:true,cancelable:true}))",
        null,
    )
}

@SuppressLint("SetJavaScriptEnabled")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Player(work: File, close: () -> Unit) {
    val context = LocalContext.current
    val activity = context as ComponentActivity
    var port by remember { mutableStateOf<Int?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var showSettings by remember { mutableStateOf(false) }
    var showKeys by remember { mutableStateOf(false) }
    var visibleKeys by remember { mutableStateOf(emptyList<KeyChoice>()) }
    val web = remember { mutableStateOf<WebView?>(null) }
    val values = remember { mutableStateMapOf<String, String>() }
    BackHandler(onBack = close)

    DisposableEffect(work) {
        val insets = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        insets.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        insets.hide(WindowInsetsCompat.Type.systemBars())
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose {
            activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            insets.show(WindowInsetsCompat.Type.systemBars())
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }
    DisposableEffect(work) {
        var process: Process? = null
        val thread = Thread {
            try {
                val free = ServerSocket(0).use { it.localPort }
                val vm = File(context.applicationInfo.nativeLibraryDir, "libnekoweb.so")
                val started = ProcessBuilder(vm.path, work.path, "--port", free.toString())
                    .redirectErrorStream(true)
                    .redirectOutput(File(context.cacheDir, "vm.log"))
                    .start()
                process = started
                repeat(300) {
                    if (!started.isAlive) error(File(context.cacheDir, "vm.log").readText().takeLast(600))
                    try {
                        Socket().use { it.connect(InetSocketAddress("127.0.0.1", free), 100) }
                        // 作品声明了哪些按键由 VM 给出；取不到时只是没有按钮，不影响运行。
                        val keys = runCatching { fetchKeys(free) }.getOrDefault(emptyList())
                        activity.runOnUiThread {
                            visibleKeys = keys
                            showKeys = keys.isNotEmpty()
                            port = free
                        }
                        return@Thread
                    } catch (_: java.io.IOException) {
                        Thread.sleep(100)
                    }
                }
                error("虚拟机启动超时")
            } catch (_: InterruptedException) {
            } catch (e: Exception) {
                activity.runOnUiThread { failure = e.message ?: "虚拟机启动失败" }
            }
        }.apply { start() }
        onDispose {
            thread.interrupt()
            process?.destroyForcibly()
        }
    }

    Box(Modifier.fillMaxSize()) {
        val ready = port
        if (ready != null) {
            AndroidView(
                modifier = Modifier.fillMaxSize().imePadding(),
                factory = { ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.mediaPlaybackRequiresUserGesture = false
                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
                        }
                        // 舞台尺寸只有页面知道：作品加载后按舞台方向锁定屏幕。
                        fun lockOrientation(view: WebView) {
                            view.evaluateJavascript("(c=>c.width&&c.height?c.width>c.height:null)(document.querySelector('#stage-box.loaded canvas')||{})") { wide ->
                                when (wide) {
                                    "true" -> activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                                    "false" -> Unit
                                    else -> view.postDelayed({ lockOrientation(view) }, 300)
                                }
                            }
                        }
                        post { lockOrientation(this) }
                        loadUrl("http://127.0.0.1:$ready/play?app=1&native=1")
                        web.value = this
                    }
                },
                onRelease = { it.destroy() },
            )
        } else {
            Surface(Modifier.fillMaxSize()) {
                Column(
                    Modifier.fillMaxSize().padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    val message = failure
                    if (message == null) {
                        CircularProgressIndicator()
                    } else {
                        Text("无法运行作品", style = MaterialTheme.typography.titleLarge)
                        Spacer(Modifier.height(8.dp))
                        Text(message, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        Column(
            Modifier.align(Alignment.TopStart).safeDrawingPadding().padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            FilledTonalIconButton(onClick = close) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回") }
            FilledTonalIconButton(onClick = { showSettings = true }) { Icon(Icons.Filled.Settings, "性能设置") }
            if (visibleKeys.isNotEmpty()) FilledTonalIconToggleButton(checked = showKeys, onCheckedChange = { showKeys = it }) { Text("键") }
        }
        if (showKeys) web.value?.let { view ->
            val arrows = visibleKeys.filter { it.code in 37..40 }.associateBy { it.code }
            val others = visibleKeys.filter { it.code !in 37..40 }
            Row(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().safeDrawingPadding().padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    arrows[38]?.let { KeyButton(view, it) }
                    Row {
                        arrows[37]?.let { KeyButton(view, it) } ?: Spacer(Modifier.width(56.dp))
                        Spacer(Modifier.width(56.dp))
                        arrows[39]?.let { KeyButton(view, it) } ?: Spacer(Modifier.width(56.dp))
                    }
                    arrows[40]?.let { KeyButton(view, it) }
                }
                @OptIn(ExperimentalLayoutApi::class)
                FlowRow(
                    Modifier.padding(start = 16.dp).weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    others.forEach { KeyButton(view, it) }
                }
            }
        }
    }

    if (showSettings) {
        ModalBottomSheet(onDismissRequest = { showSettings = false }) {
            LaunchedEffect(Unit) {
                web.value?.evaluateJavascript(
                    "JSON.stringify(Object.fromEntries(${CHOICES.joinToString(",", "[", "]") { "'${it.id}'" }}.map(i=>[i,document.getElementById(i).value])))",
                ) { json ->
                    runCatching {
                        val raw = org.json.JSONTokener(json).nextValue() as String
                        val parsed = org.json.JSONObject(raw)
                        for (choice in CHOICES) values[choice.id] = parsed.getString(choice.id)
                    }
                }
            }
            Column(
                Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 24.dp),
            ) {
                Text("性能设置", style = MaterialTheme.typography.titleLarge)
                for (choice in CHOICES) {
                    Spacer(Modifier.height(16.dp))
                    Text(choice.label, style = MaterialTheme.typography.titleSmall)
                    @OptIn(ExperimentalLayoutApi::class)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for ((label, value) in choice.options) {
                            FilterChip(
                                selected = values[choice.id] == value,
                                onClick = {
                                    values[choice.id] = value
                                    web.value?.evaluateJavascript(
                                        "(e=>{e.value='$value';e.dispatchEvent(new Event('change',{bubbles:true}))})(document.getElementById('${choice.id}'))",
                                        null,
                                    )
                                },
                                label = { Text(label) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun KeyButton(view: WebView, button: KeyChoice) {
    Surface(
        modifier = Modifier
            .defaultMinSize(minWidth = 56.dp, minHeight = 56.dp)
            .pointerInput(button.code) {
                detectTapGestures(onPress = {
                    view.key(button.code, true)
                    tryAwaitRelease()
                    view.key(button.code, false)
                })
            },
        shape = RoundedCornerShape(28.dp),
        color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.8f),
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
    ) {
        Box(Modifier.defaultMinSize(56.dp, 56.dp).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
            Text(button.label, style = MaterialTheme.typography.labelLarge)
        }
    }
}
