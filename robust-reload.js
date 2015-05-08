( function( name, definition ) {
    this.kerwitz || ( this.kerwitz = {} );
    this.kerwitz[ name ] = definition();
}( 'robust_reload', function() {
    /**
     * These are our options used within the extension.
     */
    var _options = {
            config: {
                enable_notifications: true,
                notification_timeout: 2,
                show_page_action: true,
                show_page_action_countdown: true
            },
            suggestion: chrome.i18n.getMessage( 'suggestion' ),
            commands: {
                stop:   chrome.i18n.getMessage( 'command_stop' ),
                pause:  chrome.i18n.getMessage( 'command_pause' ),
                start:  chrome.i18n.getMessage( 'command_start' ),
                config: chrome.i18n.getMessage( 'command_config' ),
                about:  chrome.i18n.getMessage( 'command_about' )
            },
            default_separator: ',',
            additional_separators: [ ';' ]
        },
        /**
         * This variable will hold all our timeout identifiers ordered by their tab_id.
         */
        _timers = {},
        /**
         * This variable holds all intervals the user entered ordered by their tab_id.
         */
        _reload_intervals = {},
        /**
         * Holds all intervals for the pageAction countdowns.
         */
        _page_action_countdown_intervals = {},
        /**
         * Holds our custom callbacks to the tabs.onUpdated event.
         */
        _tab_updated_callbacks = {},
        /**
         * The extensions main logic bundled in a variable for easier self references.
         */
        _self = {
            /**
             * Add all required event listeners and set up the extension.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             */
            initiate: function() {
                // Load the config while maintaining our defaults.
                chrome.storage.sync.get( _options.config, function( config ) {
                    _options.config = config;
                } );
                // Add the necessary event listeners.
                chrome.omnibox.onInputEntered.addListener( _self.handleInput );
                chrome.omnibox.onInputStarted.addListener( _self.pauseReloading );
                chrome.omnibox.onInputCancelled.addListener( _self.unpauseReloading );
                chrome.omnibox.setDefaultSuggestion( { description: _options.suggestion } );
                chrome.tabs.onUpdated.addListener( function( tab_id, change ) {
                    if ( change.status === 'complete' && _tab_updated_callbacks[ tab_id ] ) {
                        _tab_updated_callbacks[ tab_id ]( tab_id );
                        delete _tab_updated_callbacks[ tab_id ];
                    }
                } );
                _self.initiateMessaging();
            },
            /**
             * Setup the callbacks for messaging.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             */
            initiateMessaging: function() {
                chrome.runtime.onMessage.addListener( function( request, sender, callback ) {
                    // Only react on our own messages.
                    if ( !request.event ) return false;
                    switch( request.event ) {
                        case 'store_config':
                            _self.storeConfig( request.config );
                            break;
                        case 'get_config':
                            callback( _self.getConfig( request.config ) );
                            break;
                    }
                } );
            },
            /**
             * Handle the input the user entered into the omnibox.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {string} input
             */
            handleInput: function( input ) {
                input = input.trim();
                chrome.tabs.query(
                    { active: true, currentWindow: true },
                    function( results ) {
                        // We just did a "search" for all active tabs in the current window. results
                        // contains "all" of them. Emphasis because there really should only be one
                        // at all times.
                        var tab_id = results[ 0 ].id;
                        // Switch through our commands or parse intervals from the input if it does
                        // not match any of them.
                        switch( input ) {
                            case _options.commands.stop:
                                // Stop the current interval and clear the ones set for this tab.
                                _reload_intervals[ tab_id ] = [];
                                _self.clearCurrentInterval( tab_id );
                                _self.notify( chrome.i18n.getMessage( 'notification_stopped' ) );
                                chrome.pageAction.hide( tab_id );
                                break;
                            case _options.commands.pause:
                                // Clear the current interval but keep the ones set.
                                _self.clearCurrentInterval( tab_id );
                                _self.notify( chrome.i18n.getMessage( 'notification_paused' ) );
                                chrome.pageAction.hide( tab_id );
                                break;
                            case _options.commands.start:
                                // Start reloading again after a pause command.
                                _self.enqueueReload( tab_id );
                                _self.notify( chrome.i18n.getMessage( 'notification_started_again' ) );
                                _self.showPageAction( tab_id );
                                break;
                            case _options.commands.config:
                                chrome.tabs.create( {
                                    url: 'chrome://extensions?options='
                                        + chrome.i18n.getMessage( '@@extension_id' )
                                } );
                                break;
                            case _options.commands.about:
                                chrome.tabs.create( {
                                    url: 'http://kerwitz.github.io/robust-reload'
                                } );
                                break;
                            default:
                                // Assuming basic input of intervals.
                                // Store the input and associate it with the current tab.
                                _reload_intervals[ tab_id ] = _self.parseInput( input );
                                _self.enqueueReload( tab_id );
                                _self.notify( chrome.i18n.getMessage( 'notification_started' ) );
                                _self.showPageAction( tab_id );
                                break;
                        }
                    }
                );
            },
            /**
             * Fetch reload timeouts from the input a user entered into the omnibox.
             *
             * @author Marco Kerwitz
             * @param  {string} input
             * @return {array}  A list of the fetched timeouts.
             */
            parseInput: function( input ) {
                // Normalize the separators.
                input = input.replace(
                    new RegExp( _options.additional_separators.join( '|' ) ),
                    _options.default_separator
                );
                input = input.split( _options.default_separator );

                return input;
            },
            /**
             * Creates a new timeout for the next reload based on the current interval.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {number} tab_id
             */
            enqueueReload: function( tab_id ) {
                var interval_length = _self.parseMicroseconds( _reload_intervals[ tab_id ][ 0 ] ),
                    interval_left = interval_length - 1000,
                    canvas = document.createElement( 'canvas' ),
                    image = document.createElement( 'img' ),
                    context = canvas.getContext( '2d' );
                _timers[ tab_id ] = window.setTimeout(
                    function() {
                        // We are abstracting the onUpdated event of the chrome tabs because there
                        // is no way to remove callbacks hooked in on the original event.
                        _tab_updated_callbacks[ tab_id ] = function( tab_id ) {
                            // Make sure that our pageAction persists.
                            _self.showPageAction( tab_id );
                            // We are waiting for the tab to finish loading before we start a new
                            // interval. Otherwise we might introduce nasty infinite loops if the
                            // page takes its time to load.
                            // Move the first interval to the end of the array so we can slowly
                            // cycle through it without knowing (and storing) the current interval.
                            // This will enable us to pause and unpause at any given moment.
                            _reload_intervals[ tab_id ].push( _reload_intervals[ tab_id ].shift() );
                            _self.enqueueReload( tab_id );
                        }
                        chrome.tabs.reload( tab_id );
                    },
                    interval_length
                );
                image.src = 'rr_19.png';
                if ( _page_action_countdown_intervals[ tab_id ] ) {
                    // There was an interval still running, kill that one first.
                    window.clearInterval( _page_action_countdown_intervals[ tab_id ] );
                }
                _page_action_countdown_intervals[ tab_id ] = window.setInterval( function() {
                    if ( !_timers[ tab_id ] || interval_left <= 0 ) {
                        // Our interval has been cancelled, clear the timeout.
                        window.clearInterval( _page_action_countdown_intervals[ tab_id ] );
                        return;
                    } else if (
                        interval_left < 10000 &&
                        _options.config.show_page_action &&
                        _options.config.show_page_action_countdown
                    ) {
                        context.clearRect ( 0 , 0 , canvas.width, canvas.height )
                        context.drawImage( image, 0, 0 );
                        context.fillStyle = "rgba(0,0,0,1)";
                        context.fillRect( 11, 11, 8, 8 );
                        context.fillStyle = "white";
                        context.font = "9px monospace";
                        context.fillText( interval_left/1000, 13, 18 );
                        chrome.pageAction.setIcon( {
                            imageData: context.getImageData(0, 0, 19, 19),
                            tabId:     tab_id
                        } );
                    }
                    chrome.runtime.sendMessage( {
                        event: 'update_popup_info',
                        tab_id: tab_id,
                        interval_length: interval_length,
                        interval_left: interval_left
                    } );
                    interval_left = interval_left - 1000;
                }, 1000 );
            },
            /**
             * Shows a notification on screen and removes it later.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {string} content
             */
            notify: function( content ) {
                // Escape early if we should not use notifications.
                if ( !_options.config.enable_notifications ) return;
                var notification = new Notification(
                    chrome.i18n.getMessage( 'extension_name' ),
                    { body: content }
                );
                window.setTimeout( function() {
                    notification.close();
                }, _options.config.notification_timeout * 1000 );
            },
            /**
             * Show the page action icon if the settings allow it.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {number} tab_id
             */
            showPageAction: function( tab_id ) {
                if ( _options.config.show_page_action ) {
                    chrome.pageAction.show( tab_id );
                }
            },
            /**
             * Unset the current interval for the specified tab.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {number} tab_id
             */
            clearCurrentInterval: function( tab_id ) {
                window.clearTimeout( _timers[ tab_id ] );
                _timers[ tab_id ] = false;
            },
            /**
             * Pause the reloading intervals on the currently active tab.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             */
            pauseReloading: function() {
                chrome.tabs.query(
                    { active: true, currentWindow: true },
                    function( results ) { _self.clearCurrentInterval( results[ 0 ].id ); }
                );
            },
            /**
             * Unpause the reloading on the currently active tab.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             */
            unpauseReloading: function() {
                chrome.tabs.query(
                    { active: true, currentWindow: true },
                    function( results ) { _self.enqueueReload( _timers[ results[ 0 ].id ] ); }
                );
            },
            /**
             * Update the configuration and store it.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {object} config
             */
            storeConfig: function( config ) {
                _options.config[ config.name ] = config.value;
                chrome.storage.sync.set( _options.config );
            },
            /**
             * Get the current value for the provided config.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {object} config
             * @return {object}
             */
            getConfig: function( config ) {
                return {
                    name: config.name,
                    value: _options.config[ config.name ]
                };
            },
            /**
             * Parse microseconds from raw input like 1:20.
             *
             * @author Marco Kerwitz <marco@kerwitz.com>
             * @param  {mixed}
             * @return {number}
             */
            parseMicroseconds: function( input ) {
                var minutes = 1, seconds = 0;
                input = input.split( ':' );
                while( input.length > 0 ) {
                    seconds += minutes * parseInt( input.pop(), 10 );
                    minutes *= 60;
                }
                return seconds * 1000;
             }
        };
    // Initiate the extension.
    _self.initiate();
    // Only export the main logic and keep the options and the like private.
    return _self;
} ) );
