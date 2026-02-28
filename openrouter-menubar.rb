cask "openrouter-menubar" do
  version "1.0.0"
  sha256 "0784fef93e4ee2ea0f1a9924ee50821aae399cc86cce0259333b827beba5d457"

  url "https://github.com/volkankurt2/openrouter-menubar/releases/download/v#{version}/OpenRouter.Balance-#{version}-arm64.dmg"
  name "OpenRouter Menubar"
  desc "A menubar app to monitor and switch OpenRouter API keys"
  homepage "https://github.com/volkankurt2/openrouter-menubar"

  app "OpenRouter Balance.app"

  postflight do
    system_command "xattr",
                   args: ["-cr", "#{appdir}/OpenRouter Balance.app"],
                   sudo: true,
                   print_stderr: false
  end

  zap trash: [
    "~/Library/Application Support/openrouter-menubar",
    "~/Library/Preferences/com.openrouter.menubar.plist",
  ]
end
