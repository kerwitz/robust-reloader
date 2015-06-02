/**
 * Robust-reloader is a chrome extension that lets you reload the current tab using simple commands
 * from the omnibar.
 *
 * This is the javascript of the options panel.
 *
 * @author Marco Kerwitz <marco@kerwitz.com>
 * @see http://kerwitz.github.io/robust-reloader
 */
var element,
    input_elements = document.getElementsByClassName('config'),
    notification_options = document.getElementsByClassName('notification-options')[0],
    page_action_options = document.getElementsByClassName('page-action-options')[0],
    i18n_elements = document.getElementsByClassName('localize');
// Walk over our input elements.
for(var i = 0; i < input_elements.length; i++) {
    element = input_elements[i];
    // Store any changes made by the user immediately.
    element.addEventListener(
        (element.type === 'checkbox') ? 'change' : 'keyup',
        function(event) {
            toggleDependencies(event.target);
            chrome.runtime.sendMessage({
                event: 'store_config',
                config: {
                    name: event.target.name,
                    value: event.target.type === 'checkbox' ? event.target.checked : event.target.value
                }
            });
        }
    );
    // Restore the value of this input.
    chrome.runtime.sendMessage(
        {event: 'get_config', config: {name: element.name}},
        function(config) {
            var field = document.getElementsByName(config.name)[0];
            if (field.type === 'checkbox') field.checked = config.value;
            else field.value = config.value;
            toggleDependencies(field);
        }
    );
}
// Replace all i18n-strings in the document.
for (var i = 0; i < i18n_elements.length; i++ ) {
    i18n_elements[i].textContent = chrome.i18n.getMessage(
        i18n_elements[i].getAttribute('data-i18n')
    );
}
/**
 * Shows or hides the controls grouped under the provided input element.
 *
 * @param {element} input
 */
function toggleDependencies(input) {
    var grouped_controls = (input.name === 'enable_notifications') ? notification_options : page_action_options;
    grouped_controls.style.display = (input.checked) ? 'block' : 'none';
}
