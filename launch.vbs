Option Explicit

Dim fso, sh, folder, html, url, browser, cmd
Dim edge, edge86, chrome, chrome86

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("Wscript.Shell")

folder = fso.GetParentFolderName(WScript.ScriptFullName)
html = folder & "\index.html"

If Not fso.FileExists(html) Then
  MsgBox "Cannot find index.html next to this launcher.", vbCritical, "RGB Mixer"
  WScript.Quit 1
End If

url = "file:///" & Utf8Escape(html)

If WScript.Arguments.Count >= 1 Then
  If WScript.Arguments(0) = "/url" Then
    WScript.Echo url
    WScript.Quit 0
  End If
End If

edge = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe"
edge86 = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
chrome = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe"
chrome86 = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe"

If fso.FileExists(edge) Then
  browser = edge
ElseIf fso.FileExists(edge86) Then
  browser = edge86
ElseIf fso.FileExists(chrome) Then
  browser = chrome
ElseIf fso.FileExists(chrome86) Then
  browser = chrome86
Else
  sh.Run """" & html & """", 1, False
  WScript.Quit 0
End If

cmd = """" & browser & """ --new-window --app=""" & url & """ --window-size=1120,820"
sh.Run cmd, 1, False

Function Utf8Escape(text)
  Dim i, ch, code, out
  out = ""
  For i = 1 To Len(text)
    ch = Mid(text, i, 1)
    code = AscW(ch)
    If code < 0 Then code = code + 65536
    If (code >= 48 And code <= 57) Or (code >= 65 And code <= 90) Or (code >= 97 And code <= 122) Then
      out = out & ch
    ElseIf ch = "/" Or ch = ":" Or ch = "-" Or ch = "_" Or ch = "." Or ch = "~" Then
      out = out & ch
    ElseIf ch = "\" Then
      out = out & "/"
    Else
      out = out & PercentUtf8(code)
    End If
  Next
  Utf8Escape = out
End Function

Function PercentUtf8(code)
  Dim b1, b2, b3
  If code < 128 Then
    PercentUtf8 = "%" & Hex2(code)
  ElseIf code < 2048 Then
    b1 = 192 Or (code \ 64)
    b2 = 128 Or (code And 63)
    PercentUtf8 = "%" & Hex2(b1) & "%" & Hex2(b2)
  Else
    b1 = 224 Or (code \ 4096)
    b2 = 128 Or ((code \ 64) And 63)
    b3 = 128 Or (code And 63)
    PercentUtf8 = "%" & Hex2(b1) & "%" & Hex2(b2) & "%" & Hex2(b3)
  End If
End Function

Function Hex2(n)
  Hex2 = Right("0" & Hex(n), 2)
End Function
