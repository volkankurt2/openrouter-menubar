cask "openrouter-menubar" do
  version "1.0.1"
  sha256 "48403bba77bedee723b08330f2e43a49d9c7c3d3abfea31031b65424d37f97be"

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
