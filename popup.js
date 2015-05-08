var info = document.getElementsByClassName( 'info' )[ 0 ],
    progressBar = document.getElementById( 'progressBar' ),
    interval_table = document.getElementsByTagName( 'table' )[ 0 ],
    current_tab = null;
chrome.tabs.query( { active: true, lastFocusedWindow: true }, function( results ) {
    current_tab = results[ 0 ];
    chrome.runtime.onMessage.addListener( function( request, sender, callback ) {
        // Only react on our own messages.
        if ( !request.event ) return false;
        if ( request.tab_id !== current_tab.id ) return false;
        switch( request.event ) {
            case 'update_popup_info':
                updateInfo( request );
                break;
        }
    } );
} );

function updateInfo( request ) {
    var rows = '';
    for( var i = 0; i < request.intervals.length; i++ ) {
        rows += '<tr><td>' + request.intervals[ i ] + '</td></tr>';
    }
    interval_table.innerHTML = rows;
    info.textContent = chrome.i18n.getMessage( 'page_action_title_interval_countdown' )
        .replace( '{interval}', request.interval_length / 1000 )
        .replace( '{leftover}', request.interval_left / 1000 );
    progressBar.style.width = ( 100 - ( request.interval_left / ( request.interval_length / 100 ) ) ) + '%';
}
