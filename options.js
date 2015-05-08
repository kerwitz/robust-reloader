var i,
    input,
    value,
    input_elements = document.getElementsByClassName( 'config' ),
    notification_options = document.getElementsByClassName( 'notification-options' )[ 0 ],
    page_action_options = document.getElementsByClassName( 'page-action-options' )[ 0 ];
for( i = 0; i < input_elements.length; i++ ) {
    input = input_elements[ i ];
    // Once the user changes the value of any input on the current page we want our extension to
    // store that.
    input.addEventListener(
        ( input.type === 'checkbox' )
            ? 'change'
            : 'keyup',
        function( event ) {
            var input = event.target;
            toggleDependencies( input );
            chrome.runtime.sendMessage( {
                event: 'store_config',
                config: {
                    name: input.name,
                    value: input.type === 'checkbox'
                        ? input.checked
                        : input.value
                }
            } );
        }
    );
    // Restore the value of this input.
    chrome.runtime.sendMessage( {
        event: 'get_config',
        config: { name: input.name }
    }, function( config ) {
        var field = document.getElementsByName( config.name )[ 0 ];
        if ( field.type === 'checkbox' ) field.checked = config.value;
        else field.value = config.value;
        toggleDependencies( field );
    } );
}
// Take care of the i18n-strings.
var f,
    element,
    i18n_elements = document.getElementsByClassName( 'localize' );
for ( f = 0; f < i18n_elements.length; f++ ) {
    element = i18n_elements[ f ];
    element.textContent = chrome.i18n.getMessage( element.getAttribute( 'data-i18n' ) );
}


function toggleDependencies( input ) {
    if ( input.name === 'enable_notifications' ) {
        notification_options.style.display = ( input.checked )
             ? 'block'
             : 'none';
    } else if ( input.name === 'show_page_action' ) {
        page_action_options.style.display = ( input.checked )
            ? 'block'
            : 'none';
    }
}
