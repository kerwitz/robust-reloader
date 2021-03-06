/**
 * Robust-reloader is a chrome extension that lets you reload the current tab using simple commands
 * from the omnibar.
 *
 * This is the main class of the extension handling most of its logic.
 *
 * @author Marco Kerwitz <marco@kerwitz.com>
 * @see http://kerwitz.github.io/robust-reloader
 */
(function(name, definition) {
    this.kerwitz || (this.kerwitz = {});
    this.kerwitz[name] = definition();
}('robust_reload', function() {
    // These are our options used within the extension.
    var _options = {
            /**
             * The base configuration of the extension, this may be overwritten by the user.
             *
             * @var object
             */
            config: {
                // Should we use desktop notifications?
                enable_notifications: true,
                // If so, how long should they stay on screen?
                notification_timeout: 2,
                // Display the page action if the extension is active?
                show_page_action: true,
                // Display a progressbar of the current interval on the omnibar icon?
                show_page_action_progress: true,
                // Display a countdown within the page action icon?
                show_page_action_countdown: true,
                // The separator used between multiple intervals.
                interval_separator: ','
            },
            /**
             * The suggestion we show while the user types in a command.
             *
             * @var string
             */
            suggestion: chrome.i18n.getMessage('suggestion'),
            /**
             * These are the commands supported by this extension, note that they are also received
             * from the locales and thus are also translated.
             *
             * @var object
             */
            commands: {
                clear: chrome.i18n.getMessage('command_clear'),
                pause: chrome.i18n.getMessage('command_pause'),
                start: chrome.i18n.getMessage('command_start'),
                config: chrome.i18n.getMessage('command_config'),
                about: chrome.i18n.getMessage('command_about'),
                allPrefix: chrome.i18n.getMessage('command_all_prefix')
            }
        },
        /**
         * This variable will hold all our timeout identifiers ordered by their tab_id.
         *
         * @var object
         */
        _timers = {},
        /**
         * This variable holds all intervals the user entered ordered by their tab_id.
         *
         * @var object
         */
        _reload_intervals = {},
        /**
         * Holds all intervals for the pageAction countdowns.
         *
         * @var object
         */
        _page_action_countdown_intervals = {},
        /**
         * Holds our custom callbacks to the tabs.onUpdated event.
         *
         * @var object
         */
        _tab_updated_callbacks = {},
        /**
         * The extensions main logic bundled in a variable for easier self references.
         *
         * @var object
         */
        _self = {
            /**
             * Add all required event listeners and set up the extension.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             */
            initiate: function() {
                // Load the config while maintaining our defaults.
                chrome.storage.sync.get(_options.config, function(config) {
                    _options.config = config;
                });
                // Add the necessary event listeners.
                chrome.omnibox.onInputEntered.addListener(_self.handleInput);
                // Pause the reloading while the user is typing in a new command.
                chrome.omnibox.onInputStarted.addListener(_self.pauseReloading);
                chrome.omnibox.onInputCancelled.addListener(_self.unpauseReloading);
                chrome.omnibox.setDefaultSuggestion({description: _options.suggestion});
                // Abstract the onUpdated event for the tabs we are listening.
                chrome.tabs.onUpdated.addListener(function(tab_id, change) {
                    if (change.status === 'complete' && _tab_updated_callbacks[tab_id]) {
                        _tab_updated_callbacks[tab_id](tab_id);
                        delete _tab_updated_callbacks[tab_id];
                    }
                });
                _self.initiateMessaging();
            },
            /**
             * Setup the callbacks for messaging between the extension and page action popups.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             */
            initiateMessaging: function() {
                chrome.runtime.onMessage.addListener(function(request, sender, callback) {
                    // Only react on messages we support.
                    if (!request.event) return false;
                    switch(request.event) {
                        case 'store_config':
                            // Store a single config value (used by the options popup).
                            _self.storeConfig(request.config);
                            break;
                        case 'get_config':
                            // Load the value of a single config entry.
                            callback(_self.getConfig(request.config));
                            break;
                        case 'handle_command':
                            _self.handleInput(request.command);
                            break;
                        case 'get_pause_state':
                            callback((!_timers[request.tab_id]));
                            break;
                        case 'get_popup_info':
                            callback({intervals: _reload_intervals[request.tab_id]});
                            break;
                    }
                });
            },
            /**
             * Handle the input the user entered into the omnibox.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {string} input
             */
            handleInput: function(input) {
                let queryFilter = {};

                input = input.trim().toLowerCase();

                if (input.indexOf(_options.commands.allPrefix) === 0) {
                    input = input.replace(_options.commands.allPrefix, '').trim();
                } else {
                    // Limit this command to the current tab.
                    queryFilter = {
                        active: true,
                        currentWindow: true
                    };
                }

                chrome.tabs.query(
                    queryFilter,
                    function(results) {
                        // Switch through our commands or parse intervals from the input if it does
                        // not match any of them.
                        switch (input) {
                            case _options.commands.clear:
                                results.map(tab => {
                                    // Stop the current interval and clear the ones set for this tab.
                                    _reload_intervals[tab.id] = [];
                                    _self.clearCurrentInterval(tab.id);
                                    chrome.pageAction.hide(tab.id);
                                });
                                _self.notify(chrome.i18n.getMessage('notification_cleared'));
                                break;
                            case _options.commands.pause:
                                results.map(tab => {
                                    // Clear the current interval but keep the ones set.
                                    _self.clearCurrentInterval(tab.id);
                                    chrome.pageAction.setIcon({path: 'rr_19.png', tabId: tab.id});
                                });
                                _self.notify(chrome.i18n.getMessage('notification_paused'));
                                break;
                            case _options.commands.start:
                                results.map(tab => {
                                    // Start reloading again after a pause command.
                                    _self.enqueueReload(tab.id);
                                });
                                _self.notify(chrome.i18n.getMessage('notification_started_again'));
                                break;
                            case _options.commands.config:
                                chrome.tabs.create({
                                    url: 'chrome://extensions?options='
                                    + chrome.i18n.getMessage('@@extension_id')
                                });
                                break;
                            case _options.commands.about:
                                chrome.tabs.create({url: 'http://kerwitz.github.io/robust-reload'});
                                break;
                            default:
                                var regex = new RegExp('^[0-9' + _options.config.interval_separator + ':]*$');
                                if (input.match(regex)) {
                                    // Assuming basic input of intervals.
                                    // Store the input and associate it with the current tab.
                                    results.map(tab => {
                                        _reload_intervals[tab.id] = _self.parseInput(input);
                                        _self.enqueueReload(tab.id);
                                        _self.showPageAction(tab.id);
                                    });
                                    _self.notify(chrome.i18n.getMessage('notification_started'));
                                } else {
                                    var response = confirm(chrome.i18n.getMessage('alert_unrecognized_input'));
                                    if (response) {
                                        _self.handleInput(_options.commands.config);
                                    }
                                }
                                break;
                        }

                        // After the commands have been run update the pause state of each tab.
                        // This message will be used within popup.js to update the content of the
                        // popup accordingly.
                        results.map(tab => {
                            chrome.runtime.sendMessage({
                                event: 'update_pause_state',
                                // If there is no current timer defined for this tab it has been paused.
                                pause_state: (!_timers[tab.id]),
                                tab_id: tab.id
                            });
                        });
                    }
               );
            },
            /**
             * Fetch reload timeouts from the input a user entered into the omnibox.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {string} input
             * @return {array}  A list of the fetched timeouts.
             */
            parseInput: function(input) {
                // Split the input string by the default separator.
                input = input.split(_options.config.interval_separator);
                return input;
            },
            /**
             * Creates a new timeout for the next reload based on the current interval.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {number} tab_id
             */
            enqueueReload: function(tab_id) {
                var interval_length = _self.parseMicroseconds(_reload_intervals[tab_id][0]),
                    interval_left = interval_length - 1000;
                // Create the new reload interval for tab_id.
                _timers[tab_id] = window.setTimeout(
                    function() {
                        // We are abstracting the onUpdated event of the chrome tabs because there
                        // is no way to remove callbacks hooked in on the original event.
                        // Have a look at the initiate method above.
                        _tab_updated_callbacks[tab_id] = function(tab_id) {
                            // Make sure that our pageAction persists.
                            _self.showPageAction(tab_id);
                            // We are waiting for the tab to finish loading before we start a new
                            // interval. Otherwise we might introduce nasty infinite loops if the
                            // page takes its time to load. Move the first interval to the end of
                            // the array so we can cycle through it without knowing (and storing)
                            // the current interval. This will enable us to pause and unpause at any
                            // given moment.
                            _reload_intervals[tab_id].push(_reload_intervals[tab_id].shift());
                            _self.enqueueReload(tab_id);
                        };
                        chrome.tabs.reload(tab_id);
                    },
                    interval_length
                );
                _self.updatePageAction(tab_id, interval_left, interval_length);
            },
            /**
             * Update the page action icon and the content of its popup with the current interval.
             *
             * This method will take care of the countdown and the progress bar atop of the page
             * action icon as well as the content of popup.html.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {number} tab_id
             * @param  {number} interval_left
             * @param  {number} interval_length
             */
            updatePageAction: function(tab_id, interval_left, interval_length) {
                var canvas = document.createElement('canvas'),
                    image = document.createElement('img'),
                    context = canvas.getContext('2d'),
                    circle = Math.PI * 2,
                    quarter = Math.PI / 2;
                image.src = 'rr_19.png';
                if (_page_action_countdown_intervals[tab_id]) {
                    // There was an interval still running, kill that one first.
                    window.clearInterval(_page_action_countdown_intervals[tab_id]);
                }
                _page_action_countdown_intervals[tab_id] = window.setInterval(function() {
                    if (!_timers[tab_id] || interval_left <= 0) {
                        // Our interval has been cancelled, clear the timeout.
                        window.clearInterval(_page_action_countdown_intervals[tab_id]);
                        return;
                    } else if (_options.config.show_page_action) {
                        // We have a running interval and are allowed to show the page action.
                        context.clearRect (0, 0, canvas.width, canvas.height)
                        context.drawImage(image, 0, 0);
                        if (_options.config.show_page_action_progress) {
                            // We are allowed to render a progress indicator on the omnibar icon.
                            context.beginPath();
                            context.arc(
                                9, 9, 8.5,
                                - quarter,
                                (circle * ((interval_length - interval_left) / interval_length)) - quarter,
                                false
                            );
                            context.strokeStyle = '#0083F5';
                            context.lineWidth = 1;
                            context.stroke();
                        }
                        if (_options.config.show_page_action_countdown && interval_left < 10000) {
                            // Under 10 seconds left until the next reload and we are allowed to show
                            // a countdown on the omnibar icon. Go ahead and use canvas to draw it.
                            context.fillStyle = "rgba(0,0,0,1)";
                            context.fillRect(11, 11, 8, 8);
                            context.fillStyle = "white";
                            context.font = "9px monospace";
                            context.fillText(interval_left / 1000, 13, 18);
                        }
                        // We can set the icon of our page action to canvas by using getImageData.
                        chrome.pageAction.setIcon({
                            imageData: context.getImageData(0, 0, 19, 19),
                            tabId: tab_id
                        });
                    }
                    // Send the new interval information over to the popup.
                    chrome.runtime.sendMessage({
                        event: 'update_popup_info',
                        tab_id: tab_id,
                        intervals: _reload_intervals[tab_id],
                        interval_length: interval_length,
                        interval_left: interval_left
                    });
                    interval_left = interval_left - 1000;
                }, 1000);
            },
            /**
             * Shows a notification on screen and removes it later.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {string} content
             */
            notify: function(content) {
                // Escape early if we should not use notifications.
                if (!_options.config.enable_notifications) return;
                var notification = new Notification(
                    content,
                    {icon: 'rr_48.png'}
               );
                window.setTimeout(function() {
                    notification.close();
                }, _options.config.notification_timeout * 1000);
            },
            /**
             * Show the page action icon if the settings allow it.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {number} tab_id
             */
            showPageAction: function(tab_id) {
                if (_options.config.show_page_action) {
                    chrome.pageAction.show(tab_id);
                }
            },
            /**
             * Unset the current interval for the specified tab.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {number} tab_id
             */
            clearCurrentInterval: function(tab_id) {
                window.clearTimeout(_timers[tab_id]);
                _timers[tab_id] = false;
            },
            /**
             * Pause the reloading intervals on the currently active tab.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             */
            pauseReloading: function() {
                chrome.tabs.query(
                    {active: true, currentWindow: true},
                    function(results) { _self.clearCurrentInterval(results[0].id); }
               );
            },
            /**
             * Unpause the reloading on the currently active tab.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             */
            unpauseReloading: function() {
                chrome.tabs.query(
                    {active: true, currentWindow: true},
                    function(results) { _self.enqueueReload(_timers[results[0].id]); }
               );
            },
            /**
             * Update the configuration and store it.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {object} config
             */
            storeConfig: function(config) {
                _options.config[config.name] = config.value;
                chrome.storage.sync.set(_options.config);
            },
            /**
             * Get the current value for the provided config.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {object} config
             * @return {object}
             */
            getConfig: function(config) {
                return {
                    name: config.name,
                    value: _options.config[config.name]
                };
            },
            /**
             * Parse microseconds from raw input like 1:20.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {mixed}
             * @return {number}
             */
            parseMicroseconds: function(input) {
                var minutes = 1, seconds = 0;
                input = input.split(':');
                while(input.length > 0) {
                    seconds += minutes * parseInt(input.pop(), 10);
                    minutes *= 60;
                }
                return seconds * 1000;
             }
        };
    // Initiate the extension.
    _self.initiate();
    // Only export the main logic and keep the options and the like private.
    return _self;
}));
