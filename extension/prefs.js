import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function run(argv) {
    return new Promise((resolve,reject)=>{
        const process=Gio.Subprocess.new(argv,Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        process.wait_check_async(null,(source,result)=>{
            try {source.wait_check_finish(result);resolve();} catch(error) {reject(error);}
        });
    });
}

export default class UsagePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings=this.getSettings('org.gnome.shell.extensions.osaka-ai-usage');
        window._settings=settings;
        const page=new Adw.PreferencesPage({title:'AI usage',icon_name:'preferences-system-symbolic'});
        window.add(page);
        const appearance=new Adw.PreferencesGroup({title:'Top bar'});
        page.add(appearance);
        const percentages=new Adw.SwitchRow({title:'Show percentages',subtitle:'Turn off for a single AI logo. Full details stay in the menu.'});
        appearance.add(percentages);
        settings.bind('show-percentages',percentages,'active',Gio.SettingsBindFlags.DEFAULT);

        const refresh=new Adw.PreferencesGroup({title:'Automatic refresh',description:'Collect usage in the background. Manual refresh has a one-minute cooldown.'});
        page.add(refresh);
        const interval=new Adw.SpinRow({title:'Refresh interval (minutes)',subtitle:'Cache TTL · default 10 minutes',adjustment:new Gtk.Adjustment({lower:1,upper:60,step_increment:1,page_increment:5,value:settings.get_int('refresh-minutes')}),digits:0});
        refresh.add(interval);
        const action=new Adw.ActionRow({title:'Apply refresh interval',subtitle:'Applies to the background collector immediately.'});
        const apply=new Gtk.Button({label:'Apply',valign:Gtk.Align.CENTER});
        action.add_suffix(apply);
        refresh.add(action);
        apply.connect('clicked',async()=>{
            apply.sensitive=false;
            interval.sensitive=false;
            const minutes=Math.round(interval.value);
            const dir=GLib.build_filenamev([GLib.get_user_config_dir(),'systemd','user','osaka-ai-usage.timer.d']);
            const file=Gio.File.new_for_path(GLib.build_filenamev([dir,'refresh-interval.conf']));
            let previous=null;
            let wrote=false;
            try {
                if(file.query_exists(null))previous=file.load_contents(null)[1];
                GLib.mkdir_with_parents(dir,0o700);
                file.replace_contents(`[Timer]\nOnUnitActiveSec=\nOnUnitActiveSec=${minutes}min\nAccuracySec=1s\nRandomizedDelaySec=0\n`,null,false,Gio.FileCreateFlags.REPLACE_DESTINATION,null);
                wrote=true;
                await run(['systemctl','--user','daemon-reload']);
                await run(['systemctl','--user','restart','osaka-ai-usage.timer']);
                settings.set_int('refresh-minutes',minutes);
                action.subtitle=`Saved: refresh every ${minutes} minute${minutes===1?'':'s'}.`;
            } catch(error) {
                // Keep the previous timer and preference together if applying fails.
                if(wrote) {
                    try {
                        if(previous!==null)file.replace_contents(previous,null,false,Gio.FileCreateFlags.REPLACE_DESTINATION,null);
                        else file.delete(null);
                        await run(['systemctl','--user','daemon-reload']);
                        await run(['systemctl','--user','restart','osaka-ai-usage.timer']);
                    } catch(rollbackError) {console.error(rollbackError);}
                }
                action.subtitle='Could not apply. Check that the usage collector is installed.';
                console.error(error);
            } finally {
                apply.sensitive=true;
                interval.sensitive=true;
            }
        });
    }
}
