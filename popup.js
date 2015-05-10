chrome.tabs.query(
    { active: true, currentWindow: true },
    function( results ) {
        var info = document.getElementsByClassName( 'info' )[ 0 ],
            progress_bar = document.getElementById( 'progressBar' ),
            interval_list = document.getElementsByClassName( 'interval-list' )[ 0 ],
            control_buttons = document.getElementsByClassName('control'),
            localize_elements = document.getElementsByClassName('localize'),
            start_button = document.getElementsByClassName('start')[0],
            pause_button = document.getElementsByClassName('pause')[0],
            input = document.getElementsByTagName('input')[0],
            current_tab = null,
            element,
            current_tab = results[ 0 ];
        // Initialize the contents of the popup.
        chrome.runtime.sendMessage({event: 'get_pause_state', tab_id: current_tab.id}, updatePauseState);
        chrome.runtime.sendMessage({event: 'get_popup_info', tab_id: current_tab.id}, updateInfo);
        // Set up our messaging callbacks.
        chrome.runtime.onMessage.addListener( function( request, sender, callback ) {
            if (!request.event || request.tab_id !== current_tab.id) return false;
            switch( request.event ) {
                case 'update_popup_info':
                    updateInfo( request );
                    break;
                case 'update_pause_state':
                    updatePauseState(request.pause_state);
                    break;
            }
        } );
        // Hook in on the control buttons.
        for (var i = 0; i < control_buttons.length; i++) {
            element = control_buttons[i];
            element.addEventListener('click', function(e) {
                chrome.runtime.sendMessage({
                    event: 'handle_command',
                    command: e.target.textContent
                });
                if (e.target.textContent === chrome.i18n.getMessage( 'command_clear' )) {
                    // The user clicked on the stop button. This will hide the page action so hide the
                    // popup too.
                    window.close();
                }
            });
        }
        // Take care of the i18n-strings.
        for (var i = 0, translation = ''; i < localize_elements.length; i++) {
            element = localize_elements[i],
            translation = chrome.i18n.getMessage(element.getAttribute('data-i18n'));
            // Replace the text content of this element with the i18n language string from our translations.
            if (element.getAttribute('data-i18n-placement')) {
                element.setAttribute(element.getAttribute('data-i18n-placement'), translation);
            } else {
                element.textContent = translation;
            }
        }
        // Take care of the input field.
        input.addEventListener('keypress', function(e) {
            if (e.keyCode === 13 && e.target.value.length) {
                chrome.runtime.sendMessage({
                    event: 'handle_command',
                    command: e.target.value
                });
                if (e.target.value === chrome.i18n.getMessage( 'command_clear' )) {
                    window.close();
                }
                e.target.value = '';
                e.target.blur();
                chrome.runtime.sendMessage({event: 'get_popup_info', tab_id: current_tab.id}, updateInfo);
            }
        });
        /**
         * Updates the popup with the information provided by the request.
         * You may provide only request.intervals or only request.interval_length and request.interval_left
         * to update these parts independently from each other.
         *
         * @param {object} request
         */
        function updateInfo( request ) {
            var list_items = '';
            if (typeof request.intervals !== 'undefined') {
                for (var i = 0; i < request.intervals.length; i++) {
                    list_items += request.intervals[i];
                    if (i < request.intervals.length-1) list_items += ', ';
                }
                interval_list.innerHTML = list_items;
            }
            if (typeof request.interval_length !== 'undefined' && typeof request.interval_left !== 'undefined') {
                info.innerHTML = chrome.i18n.getMessage( 'page_action_title_interval_countdown' )
                    .replace( '{interval}', request.interval_length / 1000 )
                    .replace( '{leftover}', request.interval_left / 1000 );
                progress_bar.style.width = ( 100 - ( request.interval_left / ( request.interval_length / 100 ) ) ) + '%';
            }
        }
        /**
         * Update the popup with the current tabs pause state.
         *
         * @param {boolean} pause_state
         */
        function updatePauseState(pause_state) {
            if (!pause_state) {
                // Realoading is active.
                start_button.style.display = 'none';
                pause_button.style.display = 'block';
            } else {
                // Reloading is paused.
                start_button.style.display = 'block';
                pause_button.style.display = 'none';
                info.textContent = chrome.i18n.getMessage('page_action_title_paused');
                progress_bar.style.width = '0%';
            }
        }
    }
);
