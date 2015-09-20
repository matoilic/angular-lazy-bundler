var gulp = require('gulp');
var babel = require('gulp-babel');

gulp.task('compile', function() {
    return gulp
        .src('src/**/*.js')
        .pipe(babel({
            modules: 'common',
            loose: 'all'
        }))
        .pipe(gulp.dest('dist'));
});

gulp.task('watch', function() {
    gulp.watch('src/**/*.js', ['compile']);
});

gulp.task('default', ['compile', 'watch']);
