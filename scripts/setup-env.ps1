# Extract API keys and set as environment variables
# This script prepares the environment for Qwen Code + MiuraSwarm

$envFile = "D:\IA\API_KEYS_FREE_TIERS_IA.txt"
$settingsFile = "C:\Users\carja\.qwen\settings.json"

if (Test-Path $envFile) {
    Write-Host "📥 Reading API keys from: $envFile" -ForegroundColor Cyan
    
    # Extract NVIDIA keys (first 7)
    $nvidiaKeys = Get-Content $envFile | Where-Object { $_ -match '^OPENAI_API_KEY=nvapi-' } | Select-Object -First 7
    $nvidiaKeys = $nvidiaKeys -replace 'OPENAI_API_KEY=', ''
    
    # Set environment variables
    for ($i = 0; $i -lt $nvidiaKeys.Count; $i++) {
        $envName = "OPENAI_API_KEY_$($i + 1)"
        [Environment]::SetEnvironmentVariable($envName, $nvidiaKeys[$i], "User")
        Write-Host "✅ Set $envName" -ForegroundColor Green
    }
    
    # Extract Groq key
    $groqKey = Get-Content $envFile | Where-Object { $_ -match '^GROQ_API_KEY=gsk_' } | Select-Object -First 1
    if ($groqKey) {
        $groqKey = $groqKey -replace 'GROQ_API_KEY=', ''
        [Environment]::SetEnvironmentVariable("GROQ_API_KEY", $groqKey, "User")
        Write-Host "✅ Set GROQ_API_KEY" -ForegroundColor Green
    }
    
    # Extract Gemini keys
    $geminiKeys = Get-Content $envFile | Where-Object { $_ -match '^GEMINI_API_KEY=AIza' } | Select-Object -First 3
    $geminiKeys = $geminiKeys -replace 'GEMINI_API_KEY=', ''
    
    for ($i = 0; $i -lt $geminiKeys.Count; $i++) {
        $envName = "GEMINI_API_KEY_$($i + 1)"
        [Environment]::SetEnvironmentVariable($envName, $geminiKeys[$i], "User")
        Write-Host "✅ Set $envName" -ForegroundColor Green
    }
    
    Write-Host "`n🎉 Environment variables updated successfully!" -ForegroundColor Cyan
    Write-Host "⚠️  Restart your terminal or Qwen Code for changes to take effect." -ForegroundColor Yellow
} else {
    Write-Host "❌ File not found: $envFile" -ForegroundColor Red
}
