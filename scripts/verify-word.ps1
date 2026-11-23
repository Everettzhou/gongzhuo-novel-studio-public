$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$source = Join-Path $root 'artifacts\验收模拟小说.docx'
$output = Join-Path $root 'artifacts\Word渲染样稿.pdf'
$wordApp = $null
$document = $null
try {
    $wordApp = New-Object -ComObject Word.Application
    $wordApp.Visible = $false
    $wordApp.DisplayAlerts = 0
    $wordApp.AutomationSecurity = 3
    $document = $wordApp.Documents.Open($source, $false, $true, $false)
    $document.Repaginate()
    $pages = $document.ComputeStatistics(2)
    $text = $document.Content.Text
    if (-not $text.Contains('沈砚')) { throw 'Word opened the document but expected text is missing.' }
    $document.ExportAsFixedFormat($output, 17)
    $report = [ordered]@{ source=$source; renderedPdf=$output; pages=$pages; characters=$text.Length; application=$wordApp.Name; version=$wordApp.Version; result='passed' }
    $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'artifacts\word-validation.json') -Encoding utf8
    $report | ConvertTo-Json
} finally {
    if ($null -ne $document) { $document.Close(0); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
    if ($null -ne $wordApp) { $wordApp.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wordApp) }
}
